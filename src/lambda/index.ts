import { SQSEvent, SQSRecord, Context, Callback } from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import { ContractClient } from './ContractClient';

// Initialize clients outside the handler for reuse across invocations
const prisma = new PrismaClient();
const contractClient = new ContractClient(
  process.env.WEB3_PROVIDER_URL!,
  process.env.ORACLE_CONTRACT_ADDRESS!,
  process.env.MARKET_FACTORY_CONTRACT_ADDRESS!,
  process.env.PYTH_CONTRACT_ADDRESS!,
  process.env.PRIVATE_KEY!
);

export async function handler(event: SQSEvent, context: Context, callback: Callback): Promise<void> {
  console.log(`Processing ${event.Records.length} resolution events`);
  
  // Group records by event ID
  const eventGroups = new Map<number, SQSRecord[]>();
  
  // First pass - group by event ID
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      const eventId = message.eventId;
      
      if (!eventId) {
        console.error("Message missing eventId:", message);
        continue;
      }
      
      // Group by event ID
      const records = eventGroups.get(eventId) || [];
      records.push(record);
      eventGroups.set(eventId, records);
    } catch (error) {
      console.error("Error parsing SQS message:", error);
    }
  }
  
  // Process each event group
  const processingPromises = Array.from(eventGroups.entries()).map(
    async ([eventId, records]) => {
      try {
        // Fetch market address from smart contract
        const marketAddress = await contractClient.getMarketAddressForEvent(eventId);
        
        if (!marketAddress) {
          console.error(`No market address found for event ID ${eventId}`);
          return;
        }
        
        console.log(`Processing batch of ${records.length} messages for event ${eventId} (market: ${marketAddress})`);
        
        // Collect VAA data from all records in this batch
        const vaas: string[] = [];
        
        for (const record of records) {
          try {
            const message = JSON.parse(record.body);
            const { vaa } = message;
            
            if (vaa) {
              console.log(`Found VAA data (length: ${vaa.length}) for event ${eventId}`);
              vaas.push(vaa);
            } else {
              console.error(`No VAA data provided for event ${eventId}`);
              // Log the message structure for debugging
              console.log(`Message content: ${JSON.stringify(message, null, 2)}`);
            }
          } catch (error) {
            console.error("Error extracting VAA from message:", error);
          }
        }
        
        if (vaas.length === 0) {
          console.error(`No valid VAA data found for event ${eventId}`);
          return;
        } else {
          console.log(`Collected ${vaas.length} VAAs for event ${eventId}`);
          // Log a sample of the first VAA (first 100 chars)
          if (vaas[0]) {
            console.log(`VAA data sample: ${vaas[0].substring(0, 100)}...`);
          }
        }
        
        // Call the smart contract with all VAAs in a single transaction
        const txHash = await contractClient.updatePriceAndFulfill(
          marketAddress,
          vaas
        );
        
        console.log(`Smart contract called successfully for event ${eventId}, txHash: ${txHash}`);
        
        // Update the event in the database
        await prisma.event.update({
          where: { id: eventId },
          data: { status: 'RESOLVED' }
        });
        
        console.log(`Event ${eventId} resolved successfully`);
      } catch (error) {
        console.error(`Error processing event ${eventId}:`, error);
      }
    }
  );
  
  // Wait for all event groups to be processed
  await Promise.all(processingPromises);
  
  // Clean up
  await prisma.$disconnect();
  
  callback(null, { message: 'Processing complete' });
} 