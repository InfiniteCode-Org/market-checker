#!/bin/bash
set -e

echo "Creating Lambda deployment package..."

# Make sure the script directory exists
mkdir -p scripts

# Ensure dist directory is clean
rm -rf dist
mkdir -p dist/lambda

# Compile TypeScript code
echo "Compiling TypeScript..."
npm run build

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Create a directory for the Lambda package
PACKAGE_DIR="lambda-package"
rm -rf $PACKAGE_DIR
mkdir -p $PACKAGE_DIR

# Copy compiled code to package directory
echo "Copying compiled code..."
cp -r dist/lambda/* $PACKAGE_DIR/

# Install production dependencies in the package directory
echo "Installing production dependencies..."
cd $PACKAGE_DIR
npm init -y
npm install --production \
  @aws-sdk/client-sqs \
  @prisma/client \
  ethers \
  dotenv

# Copy Prisma generated files
echo "Copying Prisma generated files..."
mkdir -p node_modules/.prisma
cp -r ../node_modules/.prisma/client node_modules/.prisma/
cp -r ../prisma .

# Create the zip file
echo "Creating zip file..."
zip -r ../lambda-deployment-package.zip .

# Clean up
cd ..
echo "Deployment package created: lambda-deployment-package.zip"
echo "You can upload this file to AWS Lambda." 