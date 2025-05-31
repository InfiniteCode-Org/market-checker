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

## Configuration

Environment variables for the container:
- `NODE_ENV`: Set to `production` for deployment
- `SQS_QUEUE_URL`: SQS queue URL for sending price threshold events
- `DATABASE_URL`: PostgreSQL connection string

Environment variables for the Lambda:
- `SQS_QUEUE_URL`: SQS queue URL for receiving events
- `DATABASE_URL`: PostgreSQL connection string
