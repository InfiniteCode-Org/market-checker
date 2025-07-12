import { HermesClient } from "@pythnetwork/hermes-client";
import { EventEmitter } from "events";

export interface PriceUpdate {
  id: string;
  price: {
    price: string;
    conf: string;
    expo: number;
    publish_time: number;
  };
  ema_price: {
    price: string;
    conf: string;
    expo: number;
    publish_time: number;
  };
  metadata?: {
    slot: number;
    proof_available_time: number;
    prev_publish_time: number;
  };
  vaa?: string; // Binary update data for contract updates
}

export class PythClient extends EventEmitter {
  private client: HermesClient;
  private eventSource: any;
  private activePriceIds: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectInterval: number = 5000; // 5 seconds

  constructor(endpoint: string = "https://hermes.pyth.network") {
    super();
    this.client = new HermesClient(endpoint, {});
    console.log("PythClient initialized with endpoint:", endpoint);
  }

  /**
   * Subscribe to price feeds
   * @param priceIds Array of Pyth price feed IDs
   */
  async subscribeToPriceFeeds(priceIds: string[]): Promise<void> {
    try {
      // Add new price IDs to the tracking set
      priceIds.forEach(id => this.activePriceIds.add(id));
      
      // Convert set to array for subscription
      const uniqueIds = Array.from(this.activePriceIds);
      
      // Close existing connection if any
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      
      console.log(`Subscribing to ${uniqueIds.length} price feeds:`, uniqueIds);
      
      // Only establish a connection if there are price feeds to subscribe to
      if (uniqueIds.length > 0) {
        // Open new connection with all active price IDs
        this.eventSource = await this.client.getPriceUpdatesStream(uniqueIds);
        
        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        
        // Handle price updates
        this.eventSource.onmessage = (event: any) => {
          try {
            const data = JSON.parse(event.data);
           // console.log("Received data:", data);
            // Process and set the VAA data
            if (data.parsed && Array.isArray(data.parsed) && 
                data.binary && data.binary.data && Array.isArray(data.binary.data)) {
              
              // Log received data structure for debugging
            //  console.log("Received data:", data);
              
              // Process each parsed price update
              data.parsed.forEach((update: any, index: number) => {
                // Get the binary VAA data (should be at the same index)
                const vaa = data.binary.data[0] ;
                
                // Create a complete price update object with VAA data
                const priceUpdate: PriceUpdate = {
                  ...update,
                  vaa // Add the VAA data to the price update
                };
                
                // Log the update (for debugging)
                //  console.log("Received price update:", priceUpdate);
                
                // Emit the complete price update event
                this.emit('priceUpdate', priceUpdate);
              });
            } else if (data.parsed && Array.isArray(data.parsed)) {
              // Fallback for when binary data isn't available
              data.parsed.forEach((update: PriceUpdate) => {
                //console.log("Received price update (no VAA):", update);
                this.emit('priceUpdate', update);
              });
            }
          } catch (error) {
            console.error("Error parsing price update:", error);
          }
        };
        
        // Handle connection errors
        this.eventSource.onerror = (error: any) => {
          console.error("WebSocket connection error:", error);
          this.handleConnectionError();
        };
      }
    } catch (error) {
      console.error("Failed to subscribe to price feeds:", error);
      this.handleConnectionError();
    }
  }

  /**
   * Get the latest price for a specific feed
   * @param priceId Pyth Network price feed ID
   * @returns The latest price update or null if not available
   */
  async getLatestPrice(priceId: string): Promise<PriceUpdate | null> {
    try {
      console.log(`Requesting latest price for feed: ${priceId}`);
      const singleEventSource = await this.client.getPriceUpdatesStream([priceId]);
      
      return new Promise((resolve, reject) => {
        // Set a timeout to close the connection after 5 seconds
        const timeout = setTimeout(() => {
          singleEventSource.close();
          console.log(`Timeout waiting for price feed ${priceId}`);
          resolve(null);
        }, 5000);
        
        // Listen for a single message
        singleEventSource.onmessage = (event: any) => {
          try {
            clearTimeout(timeout);
            const data = JSON.parse(event.data);
            
            // Log received data structure for debugging
            console.log("Received data:", data);
            
            if (data.parsed && Array.isArray(data.parsed) && data.parsed.length > 0) {
              const updateData = data.parsed[0];
              
              // Extract the VAA binary data if available
              let vaa: string | undefined = undefined;
              if (data.binary && data.binary.data && Array.isArray(data.binary.data) && 
                  data.binary.data.length > 0) {
                vaa = data.binary.data[0];
              }
              
              // Create a complete price update with the VAA data
              const update: PriceUpdate = {
                ...updateData,
                vaa
              };
              
              singleEventSource.close();
              resolve(update);
            } else {
              singleEventSource.close();
              resolve(null);
            }
          } catch (error) {
            console.error(`Error parsing price update for ${priceId}:`, error);
            singleEventSource.close();
            resolve(null);
          }
        };
        
        // Handle errors
        singleEventSource.onerror = (error: any) => {
          console.error(`Error getting price feed ${priceId}:`, error);
          clearTimeout(timeout);
          singleEventSource.close();
          resolve(null);
        };
      });
    } catch (error) {
      console.error(`Error getting latest price for ${priceId}:`, error);
      return null;
    }
  }

  /**
   * Unsubscribe from a price feed
   * @param priceId Pyth price feed ID
   */
  unsubscribe(priceId: string): void {
    this.activePriceIds.delete(priceId);
    
    // If we still have active subscriptions, refresh them
    if (this.activePriceIds.size > 0) {
      this.subscribeToPriceFeeds(Array.from(this.activePriceIds));
    } else if (this.eventSource) {
      // No more active subscriptions, close the connection
      console.log("No more active subscriptions, closing WebSocket connection");
      this.eventSource.close();
      this.eventSource = null;
      this.reconnectAttempts = 0; // Reset reconnect attempts
    }
  }

  /**
   * Handle connection errors with exponential backoff
   */
  private handleConnectionError(): void {
    // Check if we have any price feeds to subscribe to
    if (this.activePriceIds.size === 0) {
      console.log("No active price feeds to subscribe to, skipping reconnection");
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;
      
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.subscribeToPriceFeeds(Array.from(this.activePriceIds));
      }, delay);
    } else {
      console.error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
      this.emit('connectionFailed');
    }
  }

  /**
   * Close all connections
   */
  close(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.activePriceIds.clear();
    this.removeAllListeners();
  }
} 