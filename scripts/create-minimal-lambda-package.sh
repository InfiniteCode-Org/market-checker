#!/bin/bash
set -e

echo "Creating minimal Lambda deployment package..."

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

# Create minimal package.json for Lambda
echo "Creating minimal package.json..."
cd $PACKAGE_DIR
cat > package.json << 'EOF'
{
  "name": "market-checker-lambda",
  "version": "1.0.0",
  "description": "Minimal Lambda package for market resolution",
  "main": "index.js",
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.470.0",
    "@prisma/client": "^6.8.2",
    "ethers": "^6.13.7",
    "dotenv": "^16.3.1"
  }
}
EOF

# Install only the essential dependencies
echo "Installing minimal dependencies..."
npm install --production

# Copy Prisma client from parent node_modules
echo "Copying Prisma client..."
mkdir -p $PACKAGE_DIR/node_modules/@prisma
cp -r ../node_modules/@prisma/* $PACKAGE_DIR/node_modules/@prisma/

# Create zip file
echo "Creating zip file..."
cd ..
zip -r lambda-deployment-package.zip $PACKAGE_DIR

echo "Minimal Lambda package created: lambda-deployment-package.zip"
echo "Package size: $(du -h lambda-deployment-package.zip | cut -f1)"


