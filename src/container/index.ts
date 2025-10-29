import './instrument';
import { PriceMonitor } from './PriceMonitor';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const pythEndpoint = process.env.PYTH_ENDPOINT || 'https://hermes.pyth.network';
const providerUrl = process.env.WEB3_PROVIDER_URL;
const oracleAddress = process.env.ORACLE_CONTRACT_ADDRESS;
const marketFactoryAddress = process.env.MARKET_FACTORY_CONTRACT_ADDRESS;
const pythAddress = process.env.PYTH_CONTRACT_ADDRESS;
const matchingEngineUrl = process.env.MATCHING_ENGINE_BASE_URL;

// Validate required environment variables
if (!providerUrl) {
  console.error("WEB3_PROVIDER_URL environment variable is required");
  process.exit(1);
}
if (!oracleAddress) {
  console.error("ORACLE_CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}
if (!marketFactoryAddress) {
  console.error("MARKET_FACTORY_CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}
if (!pythAddress) {
  console.error("PYTH_CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}
if (!matchingEngineUrl) {
  console.error("MATCHING_ENGINE_BASE_URL environment variable is required");
  process.exit(1);
}

// Create and start the price monitor
const monitor = new PriceMonitor(
  pythEndpoint,
  providerUrl,
  oracleAddress,
  marketFactoryAddress,
  pythAddress,
  matchingEngineUrl
);

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