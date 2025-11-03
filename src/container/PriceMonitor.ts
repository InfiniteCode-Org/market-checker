// Avoid importing Prisma enums/types in container build
type Event = any;
enum ComparisonOperator {
  LT = 'LT',
  GT = 'GT',
  EQ = 'EQ',
}
import { PythClient, PriceUpdate } from './PythClient';
import { DatabaseClient } from './DatabaseClient';
import { ContractClient } from './ContractClient';
import { logger } from '../shared/logger';

export class PriceMonitor {
  private pythClient: PythClient;
  private dbClient: DatabaseClient;
  private contractClients: ContractClient[] = [];
  private monitoringEvents: Map<string, Event[]> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private expiredCheckInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  // Track events that are in the process of being resolved
  private processingEvents: Set<number> = new Set();
  // Round-robin counter for key selection (0-9)
  private currentKeyIndex: number = 0;
  // Environment variables for contract interaction
  private providerUrl: string;
  private oracleAddress: string;
  private marketFactoryAddress: string;
  private pythAddress: string;
  private matchingEngineUrl: string;

  constructor(
    pythEndpoint: string,
    providerUrl: string,
    oracleAddress: string,
    marketFactoryAddress: string,
    pythAddress: string,
    matchingEngineUrl: string
  ) {
    this.pythClient = new PythClient(pythEndpoint);
    this.dbClient = new DatabaseClient();
    this.providerUrl = providerUrl;
    this.oracleAddress = oracleAddress;
    this.marketFactoryAddress = marketFactoryAddress;
    this.pythAddress = pythAddress;
    this.matchingEngineUrl = matchingEngineUrl;
    
    // Initialize contract clients for all 10 private keys
    for (let i = 0; i < 10; i++) {
      const privateKey = process.env[`PRIVATE_KEY_${i}`];
      if (privateKey) {
        const client = new ContractClient(
          providerUrl,
          oracleAddress,
          marketFactoryAddress,
          pythAddress,
          privateKey
        );
        this.contractClients.push(client);
        logger.info(`Initialized ContractClient ${i} for key index ${i}`);
      }
    }
    
    if (this.contractClients.length === 0) {
      throw new Error('At least one PRIVATE_KEY_N (where N is 0-9) must be set');
    }
    
    logger.info(`Initialized ${this.contractClients.length} contract clients`);
    
    // Listen for price updates
    this.pythClient.on('priceUpdate', (update: PriceUpdate) => {
      // Handle the async method properly
      this.handlePriceUpdate(update).catch(error => {
        logger.error('Error handling price update:', { error });
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
    logger.info("Starting price monitoring service");
    
    logger.info("currentKeyIndex", { currentKeyIndex: this.currentKeyIndex });
    // Initial load of events
    await this.refreshEvents();
    
    // Initial check for expired events
    await this.checkExpiredEvents();
     
    this.checkInterval = setInterval(this.refreshEvents.bind(this), 0.5 * 60 * 1000);
    
    this.expiredCheckInterval = setInterval(this.checkExpiredEvents.bind(this), 1 * 60 * 1000);
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
    
    this.pythClient.close();
    await this.dbClient.disconnect();
    
    logger.info("Price monitoring service stopped");
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
      
      logger.info(`Monitoring ${events.length} events across ${priceIds.length} price feeds`);
    } catch (error) {
      logger.error("Error refreshing events:", { error });
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
      
      logger.info(`Found ${expiredEvents.length} expired events that need resolution (safety net check)`);
      
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
                logger.info(`Skipping expired event ${event.id} - already being processed`);
                continue;
              }
              
              // Mark as being processed to prevent duplicates
              this.processingEvents.add(event.id);
              
              // Mark event as RESOLVING with winning token (NO)
              {
                const winningTokenId = event.id * 2 + 1;
                await this.dbClient.resolveEventWithOutcome(event.id, winningTokenId);
                logger.info(`Event ${event.id} marked RESOLVING with winning token ID ${winningTokenId} (outcome: NO)`);
              }

              // Resolve via contract with NO outcome
              const keyIndex = this.getNextKeyIndex();
              await this.resolveEventViaContract(event, currentPrice, 'NO', keyIndex);
              logger.info(`Event ${event.id} resolved via contract successfully`);
            }
          } else {
            // If we can't get price data, mark all events as resolved directly
            const eventIds = events.map(e => e.id);
            await this.dbClient.resolveEvents(eventIds);
            logger.info(`Events ${eventIds.join(', ')} marked as resolved (without price data)`);
          }
        } catch (error) {
          logger.error(`Error processing feed ${feedId} for expired events:`, { error });
        }
      }
    } catch (error) {
      logger.error("Error checking expired events:", { error });
    }
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
    //console.log("currentPrice", BigInt(currentPrice).toString());
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
      logger.info(`Processing price update for ${feedId.slice(0, 6)}... ${feedId.slice(-4)}: ${adjustedPrice} - monitoring events: [${eventIds.join(', ')}]`);
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
          logger.info(`Skipping duplicate processing for event ${event.id} - already being resolved`);
          continue;
        }
        
        // Check if event has expired - HYBRID APPROACH: Check expiration during price update
          if (event.end_time <= currentTime) {
          logger.info(`Event ${event.id} expired during price update, resolving as NO`);
          // Mark as being processed to prevent duplicates
          this.processingEvents.add(event.id);
          
          try {
            // Mark event as RESOLVING with winning token (NO)
            {
              const winningTokenId = event.id * 2 + 1;
              await this.dbClient.resolveEventWithOutcome(event.id, winningTokenId);
              logger.info(`Event ${event.id} marked RESOLVING with winning token ID ${winningTokenId} (outcome: NO)`);
            }

            // Resolve via contract synchronously to prevent duplicates
            const keyIndex = this.getNextKeyIndex();
            await this.resolveEventViaContract(event, update, 'NO', keyIndex);
            // Remove event from monitoring immediately
            this.removeEventFromMonitoring(feedId, event.id);
            logger.info(`Event ${event.id} resolved via contract successfully (expired)`);
          } catch (error) {
            logger.error(`Failed to resolve event ${event.id} via contract:`, { error });
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
        }  
        
        if (conditionMet) {
          logger.info(`Condition met for event ${event.id}: ${adjustedPrice} ${operator} ${triggerPrice}`);
          // Mark as being processed to prevent duplicates
          this.processingEvents.add(event.id);
          
          try {
            // Mark event as RESOLVING with winning token (YES)
            {
              const winningTokenId = event.id * 2;
              await this.dbClient.resolveEventWithOutcome(event.id, winningTokenId);
              logger.info(`Event ${event.id} marked RESOLVING with winning token ID ${winningTokenId} (outcome: YES)`);
            }

            // Resolve via contract synchronously to prevent duplicates
            const keyIndex = this.getNextKeyIndex();
            await this.resolveEventViaContract(event, update, 'YES', keyIndex);
            // Remove event from monitoring immediately
            this.removeEventFromMonitoring(feedId, event.id);
            logger.info(`Event ${event.id} resolved via contract successfully (condition met)`);
          } catch (error) {
            logger.error(`Failed to resolve event ${event.id} via contract:`, { error });
            // Remove from processing set if there was an error so it can be retried
            this.processingEvents.delete(event.id);
            
          }
        }
      } catch (error) {
        logger.error(`Error processing price update for event ${event.id}:`, { error });
      }
    }
  }

  /**
   * Handle a connection failure
   */
  private handleConnectionFailure(): void {
    logger.error("WebSocket connection failed, attempting to restart the service");
    this.stop().then(() => this.start());
  }

  private removeEventFromMonitoring(feedId: string, eventId: number): void {
    const events = this.monitoringEvents.get(feedId);
    if (!events) return;
    const remainingEvents = events.filter(e => e.id !== eventId);
    if (remainingEvents.length > 0) {
      this.monitoringEvents.set(feedId, remainingEvents);
      logger.info(`Removed event ${eventId} from monitoring feed ${feedId}. Remaining events: [${remainingEvents.map(e => e.id).join(', ')}]`);
    } else {
      this.monitoringEvents.delete(feedId);
      this.pythClient.unsubscribe(feedId);
      logger.info(`Removed event ${eventId} from monitoring feed ${feedId}. No more events for this feed, unsubscribed.`);
    }
  }

  /**
   * Get the next key index in round-robin fashion (0-9)
   */
  private getNextKeyIndex(): number {
    const keyIndex = this.currentKeyIndex;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.contractClients.length;
    logger.info(`Selected key index: ${keyIndex}`);
    return keyIndex;
  }

  /**
   * Resolve an event by calling the smart contract directly
   */
  private async resolveEventViaContract(
    event: Event,
    priceUpdate: PriceUpdate,
    winningOutcome: 'YES' | 'NO',
    keyIndex: number
  ): Promise<void> {
    try {
      // Validate VAA data
      if (!priceUpdate.vaa) {
        logger.error(`No VAA data available for event ${event.id}`);
        throw new Error('No VAA data available');
      }

      logger.info(`Resolving event ${event.id} via contract with outcome: ${winningOutcome}`);
      logger.info(`VAA data length: ${priceUpdate.vaa.length}`);

      // Get the contract client for this key index
      const contractClient = this.contractClients[keyIndex];
      if (!contractClient) {
        throw new Error(`No contract client available for key index ${keyIndex}`);
      }

      // Get market address from factory contract
      const marketAddress = await contractClient.getMarketAddressForEvent(event.id);
      if (!marketAddress) {
        throw new Error(`No market address found for event ${event.id}`);
      }

      // Call the smart contract with VAA data
      const txHash = await contractClient.updatePriceAndFulfill(
        marketAddress,
        [priceUpdate.vaa]
      );

      logger.info(`Smart contract called successfully for event ${event.id}, txHash: ${txHash}`);

      // Calculate winning token ID
      const winningTokenId = winningOutcome === 'YES' ? event.id * 2 : event.id * 2 + 1;

      // Update the event in database with resolution hash and winning token ID
      await this.dbClient.resolveEventWithOutcome(event.id, winningTokenId);
      
      // Update the resolutionHash in the database
      const dbEvent = await this.dbClient.getEventById(event.id);
      if (dbEvent) {
        await this.dbClient.updateEventResolutionHash(event.id, txHash);
        logger.info(`Event ${event.id} resolved with txHash: ${txHash} and winning token ID: ${winningTokenId}`);

        // Notify the matching engine
        try {
          await fetch(`${this.matchingEngineUrl}/api/realtime/update-event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId: event.id,
              status: 'RESOLVED',
              winningTokenId: winningTokenId,
              nickname: dbEvent.nickname || ''
            }),
          });
          logger.info(`Matching engine notified for event ${event.id}`);
        } catch (error) {
          logger.error(`Error notifying matching engine for event ${event.id}:`, { error });
        }
      }

      // Remove from processing set
      this.processingEvents.delete(event.id);
      
    } catch (error) {
      logger.error(`Error resolving event ${event.id} via contract:`, { error });
      // Remove from processing set so it can be retried
      this.processingEvents.delete(event.id);
      throw error;
    }
  }
}