#!/bin/bash
set -e

echo "Building and deploying PriceMonitor container..."

# Configuration
AWS_REGION=${AWS_REGION:-eu-west-2}
ECR_REPOSITORY_NAME="market-checker-monitor"
ECS_CLUSTER_NAME="market-checker-cluster"
ECS_SERVICE_NAME="price-monitor-service"

# Build the application first
echo "Building TypeScript application..."
bun run build

# Generate Prisma client
echo "Generating Prisma client..."
bunx prisma generate

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Create ECR repository if it doesn't exist
echo "Creating ECR repository if it doesn't exist..."
aws ecr describe-repositories --repository-names ${ECR_REPOSITORY_NAME} --region ${AWS_REGION} 2>/dev/null || \
aws ecr create-repository --repository-name ${ECR_REPOSITORY_NAME} --region ${AWS_REGION}

# Get ECR login token
echo "Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_URI}

# Build Docker image for AMD64 (Lambda architecture)
echo "Building Docker image for linux/amd64..."
docker build --platform linux/amd64 -t ${ECR_REPOSITORY_NAME}:latest .

# Tag the image
docker tag ${ECR_REPOSITORY_NAME}:latest ${ECR_URI}/${ECR_REPOSITORY_NAME}:latest

# Push to ECR
echo "Pushing image to ECR..."
docker push ${ECR_URI}/${ECR_REPOSITORY_NAME}:latest

# # Update Lambda function to use container image
# echo "Updating Lambda function..."
# aws lambda update-function-code \
#   --function-name ${LAMBDA_FUNCTION_NAME} \
#   --image-uri ${ECR_URI}/${ECR_REPOSITORY_NAME}:latest \
#   --region ${AWS_REGION}

# echo "Lambda container deployment complete!"
# echo "Image URI: ${ECR_URI}/${ECR_REPOSITORY_NAME}:latest"
