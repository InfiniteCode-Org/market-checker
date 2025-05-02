import { SQSEvent, SQSRecord, Context, Callback } from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import { ContractClient } from './ContractClient';

// Initialize clients outside the handler for reuse across invocations
const prisma = new PrismaClient();
const contractClient = new ContractClient(
  process.env.WEB3_PROVIDER_URL!,
  process.env.ORACLE_CONTRACT_ADDRESS!,
  process.env.PRIVATE_KEY!
);

export async function handler(event: SQSEvent, context: Context, callback: Callback): Promise<void> {
  console.log(`Processing ${event.Records.length} resolution events`);
  
  // Group records by market address to batch similar calls
  const marketEventMap = new Map<string, SQSRecord[]>();
  
  // First pass - group by market address
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      // Use a default market address if none is specified
      const marketAddress = process.env.MARKET_CONTRACT_ADDRESS || '';
      
      // Group by market address
      const records = marketEventMap.get(marketAddress) || [];
      records.push(record);
      marketEventMap.set(marketAddress, records);
    } catch (error) {
      console.error("Error parsing SQS message:", error);
    }
  }
  
  // Process each market batch
  const processingPromises = Array.from(marketEventMap.entries()).map(
    async ([marketAddress, records]) => {
      if (!marketAddress) {
        console.error('Market contract address is required');
        return;
      }
      
      console.log(`Processing batch of ${records.length} events for market ${marketAddress}`);
      
      // Collect VAA data from all records in this batch
      const vaas: string[] = [];
      const eventIds: number[] = [];
      
      for (const record of records) {
        try {
          const message = JSON.parse(record.body);
          const { eventId, vaa } = message;
          
          if (vaa) {
            vaas.push(vaa);
            eventIds.push(eventId);
          } else {
            console.error(`No VAA data provided for event ${eventId}`);
          }
        } catch (error) {
          console.error("Error extracting VAA from message:", error);
        }
      }
      
      if (vaas.length === 0) {
        console.error('No valid VAA data found in batch');
        return;
      }
      
      try {
        // Call the smart contract with all VAAs in a single transaction
        const txHash = await contractClient.updatePriceAndFulfill(
          marketAddress,
          vaas,
          process.env.GAS_PRICE || '50' // Gas price in gwei
        );
        
        console.log(`Smart contract called successfully with ${vaas.length} VAAs, txHash: ${txHash}`);
        
        // Update all the events in the database
        for (const eventId of eventIds) {
          try {
            await prisma.event.update({
              where: { id: eventId },
              data: { status: 'RESOLVED' }
            });
            console.log(`Event ${eventId} resolved successfully`);
          } catch (dbError) {
            console.error(`Error updating event ${eventId} in database:`, dbError);
          }
        }
      } catch (error) {
        console.error(`Error processing batch for market ${marketAddress}:`, error);
      }
    }
  );
  
  // Wait for all batches to be processed
  await Promise.all(processingPromises);
  
  // Clean up
  await prisma.$disconnect();
  
  callback(null, { message: 'Processing complete' });
} 