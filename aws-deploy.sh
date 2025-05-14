#!/bin/bash
set -e

# Set variables
REGION="us-east-1"
PROJECT_NAME="price-monitoring"
ECR_REPO_NAME="${PROJECT_NAME}-container"
LAMBDA_FUNCTION_NAME="price-resolution-lambda"
SQS_QUEUE_NAME="${PROJECT_NAME}-queue"
RDS_INSTANCE_ID="${PROJECT_NAME}-db"
ECS_CLUSTER_NAME="${PROJECT_NAME}-cluster"
ECS_SERVICE_NAME="${PROJECT_NAME}-service"
ECS_TASK_FAMILY="${PROJECT_NAME}-task"

# Step 1: Create ECR repository if it doesn't exist
echo "Creating ECR repository..."
aws ecr describe-repositories --repository-names ${ECR_REPO_NAME} --region ${REGION} || \
  aws ecr create-repository --repository-name ${ECR_REPO_NAME} --region ${REGION}

# Get ECR repository URI
ECR_REPO_URI=$(aws ecr describe-repositories --repository-names ${ECR_REPO_NAME} --region ${REGION} --query 'repositories[0].repositoryUri' --output text)

# Step 2: Build and push Docker image to ECR
echo "Building and pushing Docker image to ECR..."
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ECR_REPO_URI}
docker build -t ${ECR_REPO_URI}:latest .
docker push ${ECR_REPO_URI}:latest

# Step 3: Create SQS queue if it doesn't exist
echo "Creating SQS queue..."
SQS_QUEUE_URL=$(aws sqs create-queue --queue-name ${SQS_QUEUE_NAME} --region ${REGION} --output json | jq -r '.QueueUrl')
SQS_QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url ${SQS_QUEUE_URL} --attribute-names QueueArn --region ${REGION} --output json | jq -r '.Attributes.QueueArn')

# Step 4: Create or update Lambda function
echo "Deploying Lambda function..."
# Package Lambda function
mkdir -p dist/lambda
npm run build

# Check if Lambda function exists
LAMBDA_EXISTS=$(aws lambda list-functions --region ${REGION} --query "Functions[?FunctionName=='${LAMBDA_FUNCTION_NAME}'].FunctionName" --output text)

if [ -z "$LAMBDA_EXISTS" ]; then
    # Create Lambda function
    echo "Creating new Lambda function..."
    cd dist/lambda
    zip -r ../lambda.zip .
    cd ../..
    
    aws lambda create-function \
      --function-name ${LAMBDA_FUNCTION_NAME} \
      --runtime nodejs18.x \
      --handler index.handler \
      --role "arn:aws:iam::$(aws sts get-caller-identity --query 'Account' --output text):role/lambda-sqs-role" \
      --zip-file fileb://dist/lambda.zip \
      --region ${REGION} \
      --environment "Variables={SQS_QUEUE_URL=${SQS_QUEUE_URL},DATABASE_URL=postgresql://username:password@${RDS_INSTANCE_ID}.${REGION}.rds.amazonaws.com:5432/crypto_monitoring}"
else
    # Update Lambda function
    echo "Updating existing Lambda function..."
    cd dist/lambda
    zip -r ../lambda.zip .
    cd ../..
    
    aws lambda update-function-code \
      --function-name ${LAMBDA_FUNCTION_NAME} \
      --zip-file fileb://dist/lambda.zip \
      --region ${REGION}
fi

# Configure Lambda to be triggered by SQS
aws lambda create-event-source-mapping \
  --function-name ${LAMBDA_FUNCTION_NAME} \
  --event-source-arn ${SQS_QUEUE_ARN} \
  --region ${REGION} 2>/dev/null || echo "Lambda trigger already exists"

# Step 5: Create ECS Cluster
echo "Creating ECS Cluster..."
aws ecs create-cluster \
  --cluster-name ${ECS_CLUSTER_NAME} \
  --capacity-providers FARGATE \
  --region ${REGION}

# Step 6: Create Task Definition
echo "Creating Task Definition..."
cat > task-definition.json << EOF
{
  "family": "${ECS_TASK_FAMILY}",
  "networkMode": "awsvpc",
  "executionRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query 'Account' --output text):role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query 'Account' --output text):role/ecsTaskRole",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "${PROJECT_NAME}",
      "image": "${ECR_REPO_URI}:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8080,
          "hostPort": 8080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "SQS_QUEUE_URL", "value": "${SQS_QUEUE_URL}" },
        { "name": "DATABASE_URL", "value": "postgresql://username:password@${RDS_INSTANCE_ID}.${REGION}.rds.amazonaws.com:5432/crypto_monitoring" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${PROJECT_NAME}",
          "awslogs-region": "${REGION}",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF

aws ecs register-task-definition \
  --cli-input-json file://task-definition.json \
  --region ${REGION}

# Step 7: Create ECS Service
echo "Creating ECS Service..."
aws ecs create-service \
  --cluster ${ECS_CLUSTER_NAME} \
  --service-name ${ECS_SERVICE_NAME} \
  --task-definition ${ECS_TASK_FAMILY} \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxxxxx],securityGroups=[sg-xxxxxxxx],assignPublicIp=ENABLED}" \
  --region ${REGION} 2>/dev/null || \
aws ecs update-service \
  --cluster ${ECS_CLUSTER_NAME} \
  --service ${ECS_SERVICE_NAME} \
  --task-definition ${ECS_TASK_FAMILY} \
  --region ${REGION}

echo "Deployment completed successfully!"
echo "Note: You must create RDS instance and IAM roles manually before running this script."
echo "Note: Replace subnet-xxxxxxxx and sg-xxxxxxxx with your actual subnet and security group IDs." 