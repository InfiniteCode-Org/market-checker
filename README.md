# Price Monitoring Service - AWS Deployment

This repository contains a price monitoring service that watches cryptocurrency price feeds from Pyth Network and triggers actions when price thresholds are crossed. The system follows a serverless architecture with containerized monitoring.

## Architecture Overview

The system consists of the following components:

1. **ECS Fargate Container** - Runs the core monitoring service that connects to WebSocket price feeds and processes real-time price data
2. **WebSocket Price Feed** - External data source providing real-time price updates
3. **Amazon SQS** - Message queue that handles price threshold crossing events
4. **Lambda Function** - Processes events from SQS and executes smart contract calls
5. **PostgreSQL Database** - Stores market configuration and monitoring state
6. **Smart Contract** - External system that receives data from the Lambda function

## Deployment Options

You have two options for deploying this stack to AWS:

### Option 1: CloudFormation Template (Recommended)

The CloudFormation template creates all required resources in a single operation:

1. Build and push the Docker container image to ECR:
   ```bash
   # Log in to ECR
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $(aws sts get-caller-identity --query 'Account' --output text).dkr.ecr.us-east-1.amazonaws.com
   
   # Create ECR repository
   aws ecr create-repository --repository-name price-monitoring-container --region us-east-1
   
   # Build and push Docker image
   docker build -t price-monitoring-container .
   docker tag price-monitoring-container:latest $(aws sts get-caller-identity --query 'Account' --output text).dkr.ecr.us-east-1.amazonaws.com/price-monitoring-container:latest
   docker push $(aws sts get-caller-identity --query 'Account' --output text).dkr.ecr.us-east-1.amazonaws.com/price-monitoring-container:latest
   ```

2. Deploy the CloudFormation stack:
   ```bash
   aws cloudformation create-stack \
     --stack-name price-monitoring-stack \
     --template-body file://cloudformation-template.yaml \
     --parameters \
       ParameterKey=VpcId,ParameterValue=vpc-xxxxxxxx \
       ParameterKey=Subnets,ParameterValue="subnet-xxxxxxxx,subnet-yyyyyyyy" \
       ParameterKey=DBUsername,ParameterValue=admin \
       ParameterKey=DBPassword,ParameterValue=YourStrongPassword \
       ParameterKey=ECRImageURI,ParameterValue=$(aws sts get-caller-identity --query 'Account' --output text).dkr.ecr.us-east-1.amazonaws.com/price-monitoring-container:latest \
     --capabilities CAPABILITY_IAM
   ```

3. Monitor stack creation:
   ```bash
   aws cloudformation describe-stacks --stack-name price-monitoring-stack
   ```

### Option 2: Step-by-Step Deployment Script

Alternatively, you can use the provided shell script for a more granular deployment:

1. First, follow the steps in `aws-prerequisites.md` to set up the required IAM roles, security groups, and other prerequisites.

2. Make the deployment script executable and run it:
   ```bash
   chmod +x aws-deploy.sh
   ./aws-deploy.sh
   ```

## Updating the Lambda Function

The Lambda function code is in the `src/lambda` directory. After making changes:

```bash
npm run build
cd dist/lambda
zip -r ../lambda.zip .
cd ../..

# Update the Lambda function
aws lambda update-function-code \
  --function-name price-resolution-lambda \
  --zip-file fileb://dist/lambda.zip \
  --region us-east-1
```

## Monitoring and Logs

Check CloudWatch Logs for monitoring:

- ECS Container Logs: `/ecs/price-monitoring`
- Lambda Logs: `/aws/lambda/price-resolution-lambda`

## Cleaning Up

To remove all resources:

```bash
# If using CloudFormation
aws cloudformation delete-stack --stack-name price-monitoring-stack

# If using manual deployment
./cleanup.sh  # (if available)
```

## Configuration

Environment variables for the container:
- `NODE_ENV`: Set to `production` for deployment
- `SQS_QUEUE_URL`: SQS queue URL for sending price threshold events
- `DATABASE_URL`: PostgreSQL connection string

Environment variables for the Lambda:
- `SQS_QUEUE_URL`: SQS queue URL for receiving events
- `DATABASE_URL`: PostgreSQL connection string
