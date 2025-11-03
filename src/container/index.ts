import './instrument';
import { PriceMonitor } from './PriceMonitor';
import dotenv from 'dotenv';
import { logger } from '../shared/logger';

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
  logger.error("WEB3_PROVIDER_URL environment variable is required");
  process.exit(1);
}
if (!oracleAddress) {
  logger.error("ORACLE_CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}
if (!marketFactoryAddress) {
  logger.error("MARKET_FACTORY_CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}
if (!pythAddress) {
  logger.error("PYTH_CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}
if (!matchingEngineUrl) {
  logger.error("MATCHING_ENGINE_BASE_URL environment variable is required");
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
  logger.info('SIGTERM received, shutting down...');
  await monitor.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await monitor.stop();
  process.exit(0);
});

// Start the monitoring service
monitor.start().catch(error => {
  logger.error("Failed to start price monitoring service:", { error });
  process.exit(1);
});

logger.info("Price monitoring service started");