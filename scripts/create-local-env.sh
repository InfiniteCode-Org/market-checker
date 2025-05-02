#!/bin/bash

echo "Creating .env file for local testing..."

cat > .env << EOL
# Database connection string
DATABASE_URL="postgresql://user:password@localhost:5432/crypto_monitoring?schema=public"

# Pyth Network WebSocket endpoint
PYTH_ENDPOINT="wss://hermes.pyth.network/v2/ws"

# AWS Configuration for LocalStack
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="test"
AWS_SECRET_ACCESS_KEY="test"
SQS_QUEUE_URL="http://localhost:4566/000000000000/resolution-queue"

# Logging configuration
LOG_LEVEL="debug"
EOL

echo ".env file created successfully with local database settings."
echo "To run the migrations: npx prisma migrate dev" 