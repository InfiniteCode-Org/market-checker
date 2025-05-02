import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/resolution-queue';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Create SQS client with LocalStack endpoint
const sqsClient = new SQSClient({
  region: AWS_REGION,
  endpoint: 'http://localhost:4566',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
});

// Poll for messages
async function pollMessages() {
  try {
    const command = new ReceiveMessageCommand({
      QueueUrl: SQS_QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 5,
      MessageAttributeNames: ['All'],
      AttributeNames: ['All']
    });

    const response = await sqsClient.send(command);
    
    if (response.Messages && response.Messages.length > 0) {
      console.log(`Received ${response.Messages.length} messages`);
      
      for (const message of response.Messages) {
        // Process message
        console.log('Message ID:', message.MessageId);
        console.log('Body:', message.Body);
        
        try {
          // Parse the message body as JSON
          const body = JSON.parse(message.Body || '{}');
          console.log('Event ID:', body.eventId);
          console.log('Resolution Type:', body.resolution);
          console.log('Timestamp:', body.timestamp);
          console.log('------------------');
          
          // Delete the message from the queue after processing
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle
          });
          
          await sqsClient.send(deleteCommand);
          console.log('Message deleted from queue');
        } catch (error) {
          console.error('Error processing message:', error);
        }
      }
    } else {
      console.log('No messages received');
    }
  } catch (error) {
    console.error('Error polling messages:', error);
  }
}

// Continuously poll for messages
async function startPolling() {
  console.log('Starting to poll for messages from', SQS_QUEUE_URL);
  
  while (true) {
    await pollMessages();
    // Small delay between polling cycles
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Start polling
startPolling().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 