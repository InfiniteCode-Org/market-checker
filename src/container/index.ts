import { PriceMonitor } from './PriceMonitor';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const pythEndpoint = process.env.PYTH_ENDPOINT || 'https://hermes.pyth.network';
const sqsQueueUrl = process.env.SQS_QUEUE_URL;
const awsRegion = process.env.AWS_REGION || 'us-east-1';

if (!sqsQueueUrl) {
  console.error("SQS_QUEUE_URL environment variable is required");
  process.exit(1);
}

// Create and start the price monitor
const monitor = new PriceMonitor(pythEndpoint, sqsQueueUrl, awsRegion);

// Handle shutdown signals
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await monitor.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  await monitor.stop();
  process.exit(0);
});

// Start the monitoring service
monitor.start().catch(error => {
  console.error("Failed to start price monitoring service:", error);
  process.exit(1);
});

console.log("Price monitoring service started"); 