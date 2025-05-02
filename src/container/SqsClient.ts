import { SQS } from 'aws-sdk';
import { Event } from '@prisma/client';
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
}

export class SqsClient {
  private sqs: SQS;
  private queueUrl: string;

  constructor(region: string = 'us-east-1', queueUrl: string) {
    this.sqs = new SQS({ region });
    this.queueUrl = queueUrl;
    console.log(`SQS client initialized with queue URL: ${queueUrl}`);
  }

  /**
   * Send event resolution message to SQS
   */
  async sendResolutionEvent(event: Event, priceUpdate: PriceUpdate, winningOutcome: 'YES' | 'NO'): Promise<void> {
    try {
      if (!event.pythFeedId || !event.triggerPrice || !event.operator) {
        throw new Error(`Event ${event.id} is missing required auto-resolution fields`);
      }

      const message: ResolutionEvent = {
        eventId: event.id,
        pythFeedId: event.pythFeedId,
        triggerPrice: event.triggerPrice,
        operator: event.operator.toString(),
        actualPrice: priceUpdate.price.price,
        timestamp: priceUpdate.price.publish_time,
        winningOutcome,
        vaa: priceUpdate.vaa
      };

      const params = {
        MessageBody: JSON.stringify(message),
        QueueUrl: this.queueUrl,
        // If using a FIFO queue, uncomment these:
        // MessageGroupId: `event-${event.id}`,
        // MessageDeduplicationId: `${event.id}-${priceUpdate.price.publish_time}`
      };

      await this.sqs.sendMessage(params).promise();
      console.log(`Resolution event sent to SQS for event ${event.id} with winning outcome: ${winningOutcome}`);
    } catch (error) {
      console.error(`Error sending message to SQS for event ${event.id}:`, error);
      throw error;
    }
  }
} 