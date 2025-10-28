#!/bin/bash
set -e

echo "Building and deploying Lambda ZIP package..."

# Configuration
AWS_REGION=${AWS_REGION:-eu-west-2}
LAMBDA_FUNCTION_NAME="Devnet_Price_Resolution_Lambda"

# Build the application
echo "Building TypeScript application..."
bun run build

# Copy built files to lambda-package
echo "Copying built files..."
cp -r dist/lambda/* lambda-package/

# Zip the lambda-package directory
echo "Creating deployment package..."
cd lambda-package
zip -r ../lambda-deployment-package.zip . -x "*.git*" -x "node_modules/.cache/*"
cd ..

# Upload to Lambda
echo "Uploading to Lambda..."
aws lambda update-function-code \
  --function-name ${LAMBDA_FUNCTION_NAME} \
  --zip-file fileb://lambda-deployment-package.zip \
  --region ${AWS_REGION}

echo "Lambda deployment complete!"
echo "Function: ${LAMBDA_FUNCTION_NAME}"

