#!/bin/bash

# Create SQS Queue
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name crypto-price-queue

# Verify queue was created
aws --endpoint-url=http://localhost:4566 sqs list-queues

echo "LocalStack setup complete!" 