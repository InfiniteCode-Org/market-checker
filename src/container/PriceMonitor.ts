import { Event, ComparisonOperator } from '@prisma/client';
import { PythClient, PriceUpdate } from './PythClient';
import { DatabaseClient } from './DatabaseClient';
import { SqsClient } from './SqsClient';

export class PriceMonitor {
  private pythClient: PythClient;
  private dbClient: DatabaseClient;
  private sqsClient: SqsClient;
  private monitoringEvents: Map<string, Event[]> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private expiredCheckInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  // Track resolved events to batch process them
  private pendingResolutions: Map<number, 'YES' | 'NO'> = new Map();
  private resolutionTimeout: NodeJS.Timeout | null = null;
  // Track events that are in the process of being resolved
  private processingEvents: Set<number> = new Set();

  constructor(
    pythEndpoint: string,
    sqsQueueUrl: string,
    region: string = 'us-east-1'
  ) {
    this.pythClient = new PythClient(pythEndpoint);
    this.dbClient = new DatabaseClient();
    this.sqsClient = new SqsClient(region, sqsQueueUrl);
    
    // Listen for price updates
    this.pythClient.on('priceUpdate', (update: PriceUpdate) => {
      // Handle the async method properly
      this.handlePriceUpdate(update).catch(error => {
        console.error('Error handling price update:', error);
      });
    });
    
    // Handle connection failures
    this.pythClient.on('connectionFailed', this.handleConnectionFailure.bind(this));
  }

  /**
   * Start the monitoring service
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log("Starting price monitoring service");
    
    // Initial load of events
    await this.refreshEvents();
    
    // Initial check for expired events
    await this.checkExpiredEvents();
    
    // Set up periodic refresh of events (every 5 minutes)
    this.checkInterval = setInterval(this.refreshEvents.bind(this), 2 * 60 * 1000);
    
    // Set up periodic check for expired events (every hour - safety net)
    this.expiredCheckInterval = setInterval(this.checkExpiredEvents.bind(this), 5 * 60 * 1000);
  }

  /**
   * Stop the monitoring service
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    if (this.expiredCheckInterval) {
      clearInterval(this.expiredCheckInterval);
      this.expiredCheckInterval = null;
    }
    
    if (this.resolutionTimeout) {
      clearTimeout(this.resolutionTimeout);
      this.resolutionTimeout = null;
    }
    
    // Process any remaining resolutions
    await this.processPendingResolutions();
    
    this.pythClient.close();
    await this.dbClient.disconnect();
    
    console.log("Price monitoring service stopped");
  }

  /**
   * Refresh the list of events to monitor
   */
  private async refreshEvents(): Promise<void> {
    try {
      // Get active auto-resolution events
      const events = await this.dbClient.getActiveAutoResolutionEvents();
      
      // Group events by price feed ID
      const eventsByFeedId = new Map<string, Event[]>();
      
      for (const event of events) {
        if (!event.pythFeedId) continue;
        
        const feedEvents = eventsByFeedId.get(event.pythFeedId) || [];
        feedEvents.push(event);
        eventsByFeedId.set(event.pythFeedId, feedEvents);
      }
      
      // Update our tracking map
      this.monitoringEvents = eventsByFeedId;
      
      // Subscribe to all needed price feeds
      const priceIds = Array.from(eventsByFeedId.keys());
      await this.pythClient.subscribeToPriceFeeds(priceIds);
      
      console.log(`Monitoring ${events.length} events across ${priceIds.length} price feeds`);
    } catch (error) {
      console.error("Error refreshing events:", error);
    }
  }

  /**
   * Check for expired events that need resolution - safety net method
   */
  private async checkExpiredEvents(): Promise<void> {
    try {
      // Get expired events that still need resolution
      const expiredEvents = await this.dbClient.getExpiredAutoResolutionEvents();
      
      if (expiredEvents.length === 0) return;
      
      console.log(`Found ${expiredEvents.length} expired events that need resolution (safety net check)`);
      
      // Group expired events by pythFeedId for more efficient processing
      const feedGroups = new Map<string, Event[]>();
      
      for (const event of expiredEvents) {
        if (!event.pythFeedId) continue;
        
        const feedEvents = feedGroups.get(event.pythFeedId) || [];
        feedEvents.push(event);
        feedGroups.set(event.pythFeedId, feedEvents);
      }
      
      // Process each group of events by feed
      for (const [feedId, events] of feedGroups.entries()) {
        try {
          // Get current price for this feed (one request per feed)
          const currentPrice = await this.pythClient.getLatestPrice(feedId);
          
          if (currentPrice) {
            // Process all events for this feed with the same price data
            for (const event of events) {
              // Skip if this event is already being processed
              if (this.processingEvents.has(event.id)) {
                console.log(`Skipping expired event ${event.id} - already being processed`);
                continue;
              }
              
              // Mark as being processed to prevent duplicates
              this.processingEvents.add(event.id);
              
              // Send resolution event with NO outcome
              await this.sqsClient.sendResolutionEvent(event, currentPrice, 'NO');
              console.log(`Resolution event sent for expired event ${event.id}`);
              
              // Add to pending resolutions
              this.pendingResolutions.set(event.id, 'NO');
            }
          } else {
            // If we can't get price data, mark all events as resolved directly
            const eventIds = events.map(e => e.id);
            await this.dbClient.resolveEvents(eventIds);
            console.log(`Events ${eventIds.join(', ')} marked as resolved (without price data)`);
          }
        } catch (error) {
          console.error(`Error processing feed ${feedId} for expired events:`, error);
        }
      }
      
      // Process any pending resolutions
      await this.processPendingResolutions();
    } catch (error) {
      console.error("Error checking expired events:", error);
    }
  }

  /**
   * Process any pending event resolutions in batch
   */
  private async processPendingResolutions(): Promise<void> {
    if (this.pendingResolutions.size === 0) return;
    
    const eventIds = Array.from(this.pendingResolutions.keys());
    const resolutions = Array.from(this.pendingResolutions.entries());
    this.pendingResolutions.clear();
    
    try {
      // Update each event with its winning outcome
      await Promise.all(resolutions.map(async ([eventId, winningOutcome]) => {
        const winningTokenId = winningOutcome === 'YES' ? eventId * 2 : eventId * 2 + 1;
        
        await this.dbClient.resolveEventWithOutcome(eventId, winningTokenId);
        console.log(`Event ${eventId} resolved with winning token ID ${winningTokenId} (outcome: ${winningOutcome})`);
      }));
      
      console.log(`Batch resolved ${eventIds.length} events with winning outcomes`);
      // Clear these events from the processing set as well
      eventIds.forEach(id => this.processingEvents.delete(id));
    } catch (error) {
      console.error("Error processing pending resolutions:", error);
    }
  }

  /**
   * Schedule pending resolutions to be processed
   */
  private schedulePendingResolutions(): void {
    // Clear existing timeout if there is one
    if (this.resolutionTimeout) {
      clearTimeout(this.resolutionTimeout);
    }
    
    // Set a new timeout to process resolutions in 5 seconds
    this.resolutionTimeout = setTimeout(() => {
      // Create a new function to handle the async call
      const processResolutions = async () => {
        await this.processPendingResolutions();
      };
      
      // Call it and catch any errors
      processResolutions().catch(err => {
        console.error("Error in scheduled resolution processing:", err);
      });
      
      this.resolutionTimeout = null;
    }, 5000);
  }

  /**
   * Check if an event has expired
   */
  private isEventExpired(event: Event): boolean {
    const now = new Date();
    return event.end_time < now;
  }

  /**
   * Handle a price update from the Pyth client
   */
  private async handlePriceUpdate(update: PriceUpdate): Promise<void> {
    // console.log("update", update);
    const feedId = '0x'+update.id;
    // console.log("feedId", feedId);
    const events = this.monitoringEvents.get(feedId);
    // console.log("events", events);
    // console.log("HI")
    if (!events || events.length === 0) return;
    const eventIds = events.map(e => e.id);
    
    // Convert price to decimal for comparison
    const currentPrice = BigInt(update.price.price);
    const expo = update.price.expo;
    // Adjust currentPrice to its real value using expo
    // If expo is negative, multiply by 10^expo (i.e., divide by 10^|expo|)
    // If expo is positive, multiply by 10^expo
    let adjustedPrice: number;
    if (expo < 0) {
      adjustedPrice = Number(currentPrice) / Math.pow(10, Math.abs(expo));
    } else {
      adjustedPrice = Number(currentPrice) * Math.pow(10, expo);
    }
   // console.log("adjustedPrice", adjustedPrice, currentPrice, expo);
    // Only log occasional updates to reduce noise
    if (Math.random() < 0.1) { // Log approximately 1% of updates
      console.log(`Processing price update for ${feedId.slice(0, 6)}... ${feedId.slice(-4)}: ${adjustedPrice} - monitoring events: [${eventIds.join(', ')}]`);
      // Log which events are being processed for this price update
      
    }
    // Track events that met their condition or expired
    const resolvedEventIds: number[] = [];
    const currentTime = new Date();
    
    // Process events synchronously to prevent race conditions
    for (const event of events) {
      try {
        // Skip if missing required fields
        if (!event.triggerPrice || !event.operator) continue;
        
        // Skip if this event is already being processed for resolution
        if (this.processingEvents.has(event.id)) {
          console.log(`Skipping duplicate processing for event ${event.id} - already being resolved`);
          continue;
        }
        
        // Check if event has expired - HYBRID APPROACH: Check expiration during price update
        if (event.end_time <= currentTime) {
          console.log(`Event ${event.id} expired during price update, resolving as NO`);
          // Mark as being processed to prevent duplicates
          this.processingEvents.add(event.id);
          
          try {
            // Send resolution event synchronously to prevent duplicates
            await this.sqsClient.sendResolutionEvent(event, update, 'NO');
            this.pendingResolutions.set(event.id, 'NO');
            // Remove event from monitoring immediately
            this.removeEventFromMonitoring(feedId, event.id);
            // Schedule batch processing of resolutions
            this.schedulePendingResolutions();
            console.log(`Resolution event sent successfully for expired event ${event.id}`);
          } catch (error) {
            console.error(`Failed to send resolution event for expired event ${event.id}:`, error);
            // Remove from processing set if there was an error so it can be retried
            this.processingEvents.delete(event.id);
          }
          // Skip price check for expired events
          continue;
        }
        
        // For non-expired events, check price condition
        const triggerPrice = Number(event.triggerPrice);
        const operator = event.operator;
        let conditionMet = false;
        // Check if the condition is met
        if (operator === ComparisonOperator.GT) {
          conditionMet = adjustedPrice >= triggerPrice;
        } else if (operator === ComparisonOperator.LT) {
          conditionMet = adjustedPrice <= triggerPrice;
        } else if (operator === ComparisonOperator.EQ) {
          conditionMet = adjustedPrice === triggerPrice;
        }
        
        if (conditionMet) {
          console.log(`Condition met for event ${event.id}: ${adjustedPrice} ${operator} ${triggerPrice}`);
          // Mark as being processed to prevent duplicates
          this.processingEvents.add(event.id);
          
          try {
            // Send resolution event synchronously to prevent duplicates
            await this.sqsClient.sendResolutionEvent(event, update, 'YES');
            this.pendingResolutions.set(event.id, 'YES');
            // Remove event from monitoring immediately
            this.removeEventFromMonitoring(feedId, event.id);
            // Schedule batch processing of resolutions
            this.schedulePendingResolutions();
            console.log(`Resolution event sent successfully for event ${event.id}`);
          } catch (error) {
            console.error(`Failed to send resolution event for event ${event.id}:`, error);
            // Remove from processing set if there was an error so it can be retried
            this.processingEvents.delete(event.id);
          }
        }
      } catch (error) {
        console.error(`Error processing price update for event ${event.id}:`, error);
      }
    }
  }

  /**
   * Handle a connection failure
   */
  private handleConnectionFailure(): void {
    console.error("WebSocket connection failed, attempting to restart the service");
    this.stop().then(() => this.start());
  }

  private removeEventFromMonitoring(feedId: string, eventId: number): void {
    const events = this.monitoringEvents.get(feedId);
    if (!events) return;
    const remainingEvents = events.filter(e => e.id !== eventId);
    if (remainingEvents.length > 0) {
      this.monitoringEvents.set(feedId, remainingEvents);
      console.log(`Removed event ${eventId} from monitoring feed ${feedId}. Remaining events: [${remainingEvents.map(e => e.id).join(', ')}]`);
    } else {
      this.monitoringEvents.delete(feedId);
      this.pythClient.unsubscribe(feedId);
      console.log(`Removed event ${eventId} from monitoring feed ${feedId}. No more events for this feed, unsubscribed.`);
    }
  }
}