import { PriceMonitor } from './container/PriceMonitor';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PYTH_ENDPOINT = process.env.PYTH_ENDPOINT || 'https://hermes.pyth.network';
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/resolution-queue';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const BTC_USD_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const SOL_USD_FEED = '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

// async function setupTestEvents() {
//   const prisma = new PrismaClient();
  
//   try {
//     console.log('Setting up test events...');
    
//     // Create a test event for SOL that should trigger soon
//     // Get current SOL price and set trigger slightly above/below
//     const now = new Date();
//     const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    
//     // Create events for testing
//     await prisma.event.create({
//       data: {
//         title: 'Test BTC Price Above',
//         description: 'Will BTC price go above X?',
//         pythFeedId: BTC_USD_FEED,
//         triggerPrice: '96870', // ~$150 - adjust based on current SOL price
//         operator: ComparisonOperator.GT,
//         status: EventStatus.OPEN,
//         end_time: oneHourLater,
//         autoResolve: true,
//       }
//     });

//     await prisma.event.create({
//       data: {
//         title: 'Test SOL Price Below',
//         description: 'Will SOL price go below X?',
//         pythFeedId: SOL_USD_FEED,
//         triggerPrice: '150.288', // ~$130 - adjust based on current SOL price
//         operator: ComparisonOperator.GT,
//         status: EventStatus.OPEN,
//         end_time: oneHourLater,
//         autoResolve: true,
//       }
//     });
    
//     // // Create an event that's already expired (should resolve to NO)
//     // const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
//     // await prisma.event.create({
//     //   data: {
//     //     title: 'Test Expired Event',
//     //     description: 'This event has already expired',
//     //     pythFeedId: BTC_USD_FEED,
//     //     triggerPrice: '10000000000000', // Very high BTC price
//     //     operator: ComparisonOperator.GT,
//     //     status: EventStatus.OPEN,
//     //     end_time: yesterday,
//     //     autoResolve: true,
//     //   }
//     // });
    
//     console.log('Test events created successfully');
//   } catch (error) {
//     console.error('Error creating test events:', error);
//   } finally {
//     await prisma.$disconnect();
//   }
// }

async function startMonitor() {
  // Create a new PriceMonitor instance
  const monitor = new PriceMonitor(
    PYTH_ENDPOINT,
    SQS_QUEUE_URL,
    AWS_REGION
  );
  
  // Set up graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down monitor...');
    await monitor.stop();
    process.exit(0);
  });
  
  // Start the monitor
  await monitor.start();
  
  console.log('Monitor started. Press Ctrl+C to stop.');
}

// Main function
async function main() {
  try {
    // First set up some test events
    // await setupTestEvents();
    
    // Then start the monitor
    await startMonitor();
  } catch (error) {
    console.error('Error in test script:', error);
  }
}

main(); 