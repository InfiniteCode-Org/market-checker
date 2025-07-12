import { PrismaClient, Event, EventStatus } from '@prisma/client';

export class DatabaseClient {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Get all active events with auto-resolution enabled
   */
  async getActiveAutoResolutionEvents(): Promise<Event[]> {
    try {
      const events = await this.prisma.event.findMany({
        where: {
          status: EventStatus.OPEN,
          autoResolve: true,
          pythFeedId: { not: null },
          triggerPrice: { not: null },
          operator: { not: null },
          end_time: { gt: new Date() } // Only get events that haven't ended
        }
      });
      
      console.log(`Found ${events.length} active auto-resolution events`);
      return events;
    } catch (error) {
      console.error("Error fetching active auto-resolution events:", error);
      throw error;
    }
  }

  /**
   * Get expired events with auto-resolution enabled that need resolution
   */
  async getExpiredAutoResolutionEvents(): Promise<Event[]> {
    try {
      const events = await this.prisma.event.findMany({
        where: {
          status: EventStatus.OPEN,
          autoResolve: true,
          pythFeedId: { not: null },
          triggerPrice: { not: null },
          operator: { not: null },
          end_time: { lt: new Date() } // Only get events that have ended
        },
        take: 50 // Limit to 50 events per batch for performance
      });
      
      console.log(`Found ${events.length} expired auto-resolution events`);
      return events;
    } catch (error) {
      console.error("Error fetching expired auto-resolution events:", error);
      throw error;
    }
  }

  /**
   * Update an event status to RESOLVED with winning token ID
   */
  async resolveEventWithOutcome(eventId: number, winningTokenId: number): Promise<void> {
    try {
      await this.prisma.event.update({
        where: { id: eventId },
        data: { 
          status: EventStatus.RESOLVED,
          winningTokenId: winningTokenId
        }
      });
      
      console.log(`Event ${eventId} marked as resolved with winning token ID ${winningTokenId}`);
    } catch (error) {
      console.error(`Error resolving event ${eventId} with outcome:`, error);
      throw error;
    }
  }

  /**
   * Update an event status to RESOLVED
   */
  async resolveEvent(eventId: number): Promise<void> {
    try {
      await this.prisma.event.update({
        where: { id: eventId },
        data: { status: EventStatus.RESOLVED }
      });
      
      console.log(`Event ${eventId} marked as resolved in the database`);
    } catch (error) {
      console.error(`Error resolving event ${eventId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update multiple events' status to RESOLVED in a single transaction
   */
  async resolveEvents(eventIds: number[]): Promise<void> {
    if (eventIds.length === 0) return;
    
    try {
      // Use a transaction to ensure all updates happen or none
      await this.prisma.$transaction(async (tx) => {
        await Promise.all(eventIds.map(eventId => 
          tx.event.update({
            where: { id: eventId },
            data: { status: EventStatus.RESOLVED }
          })
        ));
      });
      
      console.log(`Batch resolved ${eventIds.length} events: ${eventIds.join(', ')}`);
    } catch (error) {
      console.error(`Error batch resolving events:`, error);
      throw error;
    }
  }

  /**
   * Find markets associated with an event
   */
  async getEventMarkets(eventId: number) {
    try {
      const markets = await this.prisma.market.findMany({
        where: { eventId }
      });
      
      return markets;
    } catch (error) {
      console.error(`Error getting markets for event ${eventId}:`, error);
      throw error;
    }
  }

  /**
   * Get event details by ID
   */
  async getEventById(eventId: number): Promise<Event | null> {
    try {
      return await this.prisma.event.findUnique({
        where: { id: eventId }
      });
    } catch (error) {
      console.error(`Error getting event ${eventId}:`, error);
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
} 