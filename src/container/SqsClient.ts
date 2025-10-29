import { SQS } from 'aws-sdk';
type Event = any;
import { PriceUpdate } from './PythClient';

interface ResolutionEvent {
  eventId: number;
  pythFeedId: string;
  triggerPrice: string;
  operator: string;
  actualPrice: string;
  timestamp: number;
  winningOutcome: 'YES' | 'NO';
  vaa?: string; // Binary data needed for contract updates
  keyIndex: number; // Which private key to use (0-9)
}

export class SqsClient {
  private sqs?: SQS;
  private queueUrl: string;
  private isLocalMode: boolean;

  constructor(region: string = 'us-east-1', queueUrl: string) {
    this.queueUrl = queueUrl;
    
    // Support explicit LocalStack endpoint when provided
    const explicitEndpoint = process.env.AWS_SQS_ENDPOINT; // e.g. http://localhost:4566

    // Check if we're in local development mode (no AWS credentials)
    this.isLocalMode = !process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SECRET_ACCESS_KEY && !explicitEndpoint;

    if (explicitEndpoint) {
      // Configure SQS to talk to LocalStack even without real AWS creds
      this.sqs = new SQS({
        region,
        endpoint: explicitEndpoint,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
        }
      });
      this.isLocalMode = false; // allow actual sending via LocalStack
      console.log(`SQS client initialized with explicit endpoint ${explicitEndpoint} and queue URL: ${queueUrl}`);
    } else if (this.isLocalMode) {
      console.log(`SQS client initialized in LOCAL MODE - queue URL: ${queueUrl}`);
      console.log('AWS credentials not found. Resolution events will be logged but not sent to SQS.');
    } else {
      this.sqs = new SQS({ region });
      console.log(`SQS client initialized with queue URL: ${queueUrl}`);
    }
  }

  /**
   * Send event resolution message to SQS
   */
  async sendResolutionEvent(event: Event, priceUpdate: PriceUpdate, winningOutcome: 'YES' | 'NO', keyIndex: number): Promise<void> {
    try {
      if (!event.pythFeedId || !event.triggerPrice || !event.operator) {
        throw new Error(`Event ${event.id} is missing required auto-resolution fields`);
      }

      // Check if VAA data is available and log it
      if (priceUpdate.vaa) {
        console.log(`Including VAA data (length: ${priceUpdate.vaa.length}) for event ${event.id}`);
      } else {
        console.log(`WARNING: No VAA data available for event ${event.id}`);
      }

      const message: ResolutionEvent = {
        eventId: event.id,
        pythFeedId: event.pythFeedId,
        triggerPrice: event.triggerPrice,
        operator: event.operator.toString(),
        actualPrice: priceUpdate.price.price,
        timestamp: priceUpdate.price.publish_time,
        winningOutcome,
        vaa: priceUpdate.vaa,
        keyIndex: keyIndex
      };
     
     // console.log(`Sending resolution event to SQS for event ${event.id} with winning outcome: ${winningOutcome}`);
      console.log(`Message:`, JSON.stringify(message));

      const params: any = {
        MessageBody: JSON.stringify(message),
        QueueUrl: this.queueUrl,
      };

      // Check if this is a FIFO queue (ends with .fifo)
      const isFifoQueue = this.queueUrl.endsWith('.fifo');
      
      if (isFifoQueue) {
        // FIFO queue parameters
        params.MessageGroupId = `event-${event.id}`;
        params.MessageDeduplicationId = `${event.id}-${priceUpdate.price.publish_time}-${winningOutcome}`;
        console.log(`Using FIFO queue with deduplication ID: ${params.MessageDeduplicationId}`);
      }

      if (this.isLocalMode) {
        // In local mode, just log the resolution event
        console.log(`[LOCAL MODE] Resolution event for event ${event.id}:`, JSON.stringify(message, null, 2));
        console.log(`[LOCAL MODE] Would send to SQS queue: ${this.queueUrl}`);
        if (isFifoQueue) {
          console.log(`[LOCAL MODE] FIFO queue parameters:`, {
            MessageGroupId: params.MessageGroupId,
            MessageDeduplicationId: params.MessageDeduplicationId
          });
        }
      } else {
        // In production mode, send to SQS
        if (!this.sqs) {
          throw new Error('SQS client not initialized');
        }
        await this.sqs.sendMessage(params).promise();
        console.log(`Resolution event sent to SQS for event ${event.id} with winning outcome: ${winningOutcome}`);
        if (isFifoQueue) {
          console.log(`Message sent with deduplication ID: ${params.MessageDeduplicationId}`);
        }
      }
    } catch (error) {
      console.error(`Error sending message to SQS for event ${event.id}:`, error);
      Sentry.captureException(error);
      throw error;
    }
  }
} 