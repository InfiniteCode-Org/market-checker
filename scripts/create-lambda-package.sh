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
bun run build

# Generate Prisma client
echo "Generating Prisma client..."
bunx prisma generate

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
  "name": "lambda-package",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.470.0",
    "@prisma/client": "^6.8.2",
    "ethers": "^6.13.7",
    "dotenv": "^16.3.1"
  }
}
EOF

# Install only production dependencies
echo "Installing production dependencies..."
bun install --production

# Copy only necessary Prisma files
echo "Copying Prisma files..."
mkdir -p node_modules/.prisma
cp -r ../node_modules/.prisma/client node_modules/.prisma/
cp -r ../prisma .

# Aggressively remove unnecessary files to reduce size
echo "Aggressively removing unnecessary files..."
find . -name "*.d.ts" -delete
find . -name "*.map" -delete
find . -name "*.md" -delete
find . -name "LICENSE" -delete
find . -name "CHANGELOG*" -delete
find . -name "README*" -delete
find . -name "test" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "__tests__" -type d -exec rm -rf {} + 2>/dev/null || true

# Remove unnecessary AWS SDK components (keep only SQS)
echo "Removing unnecessary AWS SDK components..."
cd node_modules/@aws-sdk
# Keep only SQS client and core dependencies
find . -maxdepth 1 -type d ! -name "client-sqs" ! -name "." -exec rm -rf {} + 2>/dev/null || true
cd ../..

# Remove unnecessary Prisma components
echo "Removing unnecessary Prisma components..."
cd node_modules/@prisma
# Keep only the client, remove other components
find . -maxdepth 1 -type d ! -name "client" ! -name "." -exec rm -rf {} + 2>/dev/null || true
cd ../..

# Remove unnecessary ethers components
echo "Removing unnecessary ethers components..."
cd node_modules/ethers
# Keep only essential files
find . -name "*.d.ts" -delete
find . -name "*.map" -delete
find . -name "*.md" -delete
find . -name "LICENSE" -delete
find . -name "CHANGELOG*" -delete
find . -name "README*" -delete
cd ../..

# Remove all TypeScript definition files
find . -name "*.d.ts" -delete

# Remove all source maps
find . -name "*.map" -delete

# Remove all documentation files
find . -name "*.md" -delete
find . -name "LICENSE*" -delete
find . -name "CHANGELOG*" -delete
find . -name "README*" -delete

# Remove all test files
find . -name "test" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "__tests__" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "*.test.*" -delete
find . -name "*.spec.*" -delete

# Remove all browser-specific files
find . -name "*.browser.*" -delete

# Remove all development files
find . -name "*.dev.*" -delete
find . -name "*.development.*" -delete

# Create the zip file
echo "Creating zip file..."
zip -r ../lambda-deployment-package.zip . -x "*.git*" "*.DS_Store*"

# Clean up
cd ..
echo "Deployment package created: lambda-deployment-package.zip"
echo "Package size: $(du -h lambda-deployment-package.zip | cut -f1)"
echo "You can upload this file to AWS Lambda." 