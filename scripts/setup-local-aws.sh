#!/bin/bash

echo "Setting up AWS resources in LocalStack..."

# Set AWS region and credentials for LocalStack
export AWS_DEFAULT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

# Create SQS queue
echo "Creating SQS queue..."
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name resolution-queue 2>/dev/null

# List queues to verify
echo "Verifying queue creation..."
aws --endpoint-url=http://localhost:4566 sqs list-queues 2>/dev/null

echo "Setup complete!" 