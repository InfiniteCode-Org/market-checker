import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import dotenv from 'dotenv';
import { handler } from './lambda/index';
import { SQSEvent, SQSRecord, Context, Callback } from 'aws-lambda';

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

// Create a mock Lambda context
const createContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'local-lambda',
  functionVersion: 'local',
  invokedFunctionArn: 'local',
  memoryLimitInMB: '128',
  awsRequestId: `local-${Date.now()}`,
  logGroupName: 'local',
  logStreamName: 'local',
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {}
});

// Simulates SQS triggering the Lambda function
async function simulateSqsToLambdaFlow() {
  console.log('Simulating SQS -> Lambda trigger flow...');
  
  try {
    // SQS part: Receive messages (Lambda would be triggered automatically in AWS)
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: SQS_QUEUE_URL,
      MaxNumberOfMessages: 10, // AWS Lambda can be triggered with up to 10 messages
      WaitTimeSeconds: 5,
      MessageAttributeNames: ['All'],
      AttributeNames: ['All']
    });

    const response = await sqsClient.send(receiveCommand);
    
    // If no messages, just return
    if (!response.Messages || response.Messages.length === 0) {
      console.log('No messages in queue');
      return;
    }
    
    console.log(`SQS trigger: ${response.Messages.length} messages received`);
    
    // Convert SQS messages to the event format Lambda expects
    const sqsEvent: SQSEvent = {
      Records: response.Messages.map(message => {
        // Use type assertion to match SQSRecord structure
        return {
          messageId: message.MessageId || '',
          receiptHandle: message.ReceiptHandle || '',
          body: message.Body || '',
          attributes: message.Attributes || {},
          messageAttributes: message.MessageAttributes ? 
            Object.entries(message.MessageAttributes).reduce((acc, [key, value]) => {
              if (value) {
                acc[key] = {
                  dataType: value.DataType || 'String',
                  stringValue: value.StringValue,
                  binaryValue: value.BinaryValue
                };
              }
              return acc;
            }, {} as Record<string, { dataType: string, stringValue?: string, binaryValue?: Uint8Array }>) : {},
          md5OfBody: message.MD5OfBody || '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:resolution-queue',
          awsRegion: AWS_REGION
        } as unknown as SQSRecord;
      })
    };
    
    // Log basic message info
    for (const record of sqsEvent.Records) {
      try {
        const body = JSON.parse(record.body);
        console.log(`Event ID: ${body.eventId}, Resolution: ${body.resolution}`);
      } catch (error) {
        console.error('Error parsing message body');
      }
    }
    
    console.log('------------------------------------------');
    console.log(`Lambda triggered with ${sqsEvent.Records.length} messages`);
    console.log('------------------------------------------');
    
    // Lambda part: AWS would automatically invoke the Lambda function with the SQS event
    const context = createContext();
    
    // This mimics AWS invoking our Lambda function
    const lambdaPromise = new Promise<void>((resolve, reject) => {
      // Cast the callback function to match expected type
      const callback: Callback = (error, result) => {
        if (error) {
          console.error('Lambda handler returned error:', error);
          reject(error);
        } else {
          console.log('Lambda execution result:', result);
          resolve();
        }
      };
      
      handler(sqsEvent, context, callback);
    });
    
    // Wait for Lambda execution to complete
    await lambdaPromise;
    console.log('Lambda execution complete');
    
    // In AWS, messages are automatically deleted from the queue if Lambda succeeds
    // We'll simulate that behavior by deleting the messages now
    for (const message of response.Messages) {
      try {
        const deleteCommand = new DeleteMessageCommand({
          QueueUrl: SQS_QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle
        });
        
        await sqsClient.send(deleteCommand);
        console.log(`Message ${message.MessageId} deleted from queue (successful Lambda execution)`);
      } catch (error) {
        console.error(`Error deleting message ${message.MessageId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in SQS -> Lambda flow:', error);
  }
}

// Start continuous simulation of SQS -> Lambda flow
async function startSimulation() {
  console.log('Starting SQS -> Lambda trigger simulation');
  console.log(`Listening to SQS queue: ${SQS_QUEUE_URL}`);
  console.log('Each batch of messages will trigger the Lambda function automatically');
  console.log('Press Ctrl+C to stop');
  
  while (true) {
    await simulateSqsToLambdaFlow();
    // Small delay between polling cycles
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Start simulation
startSimulation().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 