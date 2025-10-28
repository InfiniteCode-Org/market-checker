import { SQSEvent, SQSRecord, Context, Callback } from 'aws-lambda';
import { PrismaClient } from '@prisma/client';
import { ContractClient } from './ContractClient';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Keep a global reference of the Prisma client, but don't initialize it outside the handler
// Per-invocation initialization is safer for Lambda
let prismaInstance: PrismaClient | null = null;

// Function to get Prisma client - will initialize on first call and reuse on subsequent calls
function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    console.log("Initializing new Prisma client");
    try {
      prismaInstance = new PrismaClient({
        errorFormat: 'minimal',
        log: ['query', 'info', 'warn', 'error'],
      });
      console.log("Prisma client initialized successfully");
    } catch (error) {
      console.error("Error initializing Prisma client:", error);
      throw error;
    }
  }
  return prismaInstance;
}

export async function handler(event: SQSEvent, context: Context, callback: Callback): Promise<void> {
  // Disable connection pooling - proper way to use Prisma in AWS Lambda
  context.callbackWaitsForEmptyEventLoop = false;

  let prisma: PrismaClient | null = null;
  let contractClient: ContractClient | null = null;

  try {
    console.log(`Processing ${event.Records.length} resolution events`);

    // Validate all required environment variables are present
    const requiredEnvVars = [
      'DATABASE_URL',
      'WEB3_PROVIDER_URL',
      'ORACLE_CONTRACT_ADDRESS',
      'MARKET_FACTORY_CONTRACT_ADDRESS',
      'PYTH_CONTRACT_ADDRESS'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Required environment variable ${envVar} is not set`);
      }
    }

    // Validate at least one private key exists
    const hasAnyPrivateKey = Array.from({ length: 10 }, (_, i) => 
      process.env[`PRIVATE_KEY_${i}`]
    ).some(key => key !== undefined);

    if (!hasAnyPrivateKey) {
      throw new Error('At least one PRIVATE_KEY_N (where N is 0-9) must be set');
    }

    // Initialize Prisma
    console.log("Getting Prisma client...");
    prisma = getPrismaClient();

    // Test the database connection
    console.log("Testing database connection...");
    await prisma.$connect();
    console.log("Database connection verified");

    // Group records by event ID
    const eventGroups = new Map<number, SQSRecord[]>();

    // Track processed events to prevent duplicates within this invocation
    const processedEvents = new Set<number>();

    // First pass - group by event ID
    for (const record of event.Records) {
      try {
        const message = JSON.parse(record.body);
        const eventId = message.eventId;

        if (!eventId) {
          console.error("Message missing eventId:", message);
          continue;
        }

        // Skip if we've already processed this event in this invocation
        if (processedEvents.has(eventId)) {
          console.log(`Skipping duplicate event ${eventId} in this invocation`);
          continue;
        }

        // Validate keyIndex is present
        if (message.keyIndex === undefined) {
          console.error(`Message for event ${eventId} missing keyIndex, defaulting to 0`);
          message.keyIndex = 0;
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
          // Mark this event as processed to prevent duplicates
          processedEvents.add(eventId);

          // Extract keyIndex from first record
          const firstMessage = JSON.parse(records[0].body);
          const keyIndex = firstMessage.keyIndex ?? 0;
          const privateKey = process.env[`PRIVATE_KEY_${keyIndex}`];

          if (!privateKey) {
            throw new Error(`PRIVATE_KEY_${keyIndex} is not set in environment variables`);
          }

          console.log(`Using PRIVATE_KEY_${keyIndex} for event ${eventId}`);

          // Initialize contract client with selected private key
          const eventContractClient = new ContractClient(
            process.env.WEB3_PROVIDER_URL!,
            process.env.ORACLE_CONTRACT_ADDRESS!,
            process.env.MARKET_FACTORY_CONTRACT_ADDRESS!,
            process.env.PYTH_CONTRACT_ADDRESS!,
            privateKey
          );

          // Verify Pyth contract interface
          await eventContractClient.verifyPythContract();

          // Fetch market address from smart contract
          const marketAddress = await eventContractClient.getMarketAddressForEvent(eventId);

          if (!marketAddress) {
            console.error(`No market address found for event ID ${eventId}`);
            return;
          }

          console.log(`Processing batch of ${records.length} messages for event ${eventId} (market: ${marketAddress})`);

          // Collect VAA data from all records in this batch
          const vaas: string[] = [];
          let winningOutcome: 'YES' | 'NO' | null = null;

          for (const record of records) {
            try {
              const message = JSON.parse(record.body);
              const { vaa, winningOutcome: messageOutcome } = message;

              // Extract winning outcome from first record (all should be the same)
              if (winningOutcome === null && messageOutcome) {
                winningOutcome = messageOutcome;
                console.log(`Extracted winning outcome: ${winningOutcome} for event ${eventId}`);
              }

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

          if (!winningOutcome) {
            console.error(`No winning outcome found for event ${eventId}`);
            return;
          }

          // Calculate winning token ID based on the outcome
          const winningTokenId = winningOutcome === 'YES' ? eventId * 2 : eventId * 2 + 1;
          console.log(`Calculated winning token ID: ${winningTokenId} for event ${eventId} (outcome: ${winningOutcome})`);

          // Call the smart contract with all VAAs in a single transaction
          let txHash: string;
          try {
            txHash = await eventContractClient.updatePriceAndFulfill(
              marketAddress,
              vaas
            );

            console.log(`Smart contract called successfully for event ${eventId}, txHash: ${txHash}`);

            // Update the event with resolution hash and winning token ID after successful confirmation
            if (!prisma) {
              throw new Error("Prisma client not initialized");
            }

            try {
              const event = await prisma.event.findUnique({
                where: {
                  id: eventId
                }
              });
              if (!event) {
                console.log(`Event with ID ${eventId} not found`);
                return;
              }
              await fetch(
                `${process.env.MATCHING_ENGINE_BASE_URL}/api/realtime/update-event`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    eventId: event.id,
                    status: 'RESOLVED',
                    winningTokenId: winningTokenId,
                    nickname: event?.nickname || ""
                  }),
                }
              );
            } catch (error) {
              console.log("Error updating testnet outcome market frontend:", error);
            }
            await prisma.event.update({
              where: { id: eventId },
              data: {
                resolutionHash: txHash,
                winningTokenId: winningTokenId,
                status: 'RESOLVED'
              }
            });

            console.log(`Event ${eventId} resolved successfully with resolution hash: ${txHash} and winning token ID: ${winningTokenId}`);

          } catch (contractError) {
            console.error(`Smart contract transaction failed for event ${eventId}:`, contractError);

            // Log the failure but don't change status - let the market checker bot handle it
            console.log(`Event ${eventId} resolution failed. Status remains RESOLVING for market checker bot to handle.`);

            // Re-throw the error to be caught by the outer catch block
            throw contractError;
          }
        } catch (error) {
          console.error(`Error processing event ${eventId}:`, error);
        }
      }
    );

    // Wait for all event groups to be processed
    await Promise.all(processingPromises);

    // Clean up
    if (prisma) {
      console.log("Disconnecting from database...");
      await prisma.$disconnect();
    }

    callback(null, { message: 'Processing complete' });
  } catch (error) {
    console.error("Error in Lambda handler:", error);
    // Try to disconnect from database if it was connected
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch (disconnectError) {
        console.error("Error disconnecting from database:", disconnectError);
      }
    }
    // Convert the error to proper type expected by callback
    callback(error instanceof Error ? error : new Error(String(error)));
  }
} 