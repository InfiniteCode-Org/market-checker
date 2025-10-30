# Price Monitoring Service

This repository contains a price monitoring service that watches cryptocurrency price feeds from Pyth Network and triggers smart contract resolutions when price thresholds are crossed or events expire.

## Architecture Overview

The system consists of the following components:

1. **Checker Bot (ECS Fargate Container)** - Runs the core monitoring service that:
   - Connects to Pyth Network WebSocket price feeds for real-time data
   - Monitors events with auto-resolution enabled
   - Checks price conditions (GT/LT thresholds) and expiration times
   - Directly calls smart contracts to resolve events when conditions are met
   - Updates the database with resolution details

2. **Pyth Network** - External WebSocket price feed providing real-time cryptocurrency price data with VAA (Verifiable Action Approval) signatures

3. **PostgreSQL Database** - Stores:
   - Event configuration (price thresholds, operators, feed IDs)
   - Market state and resolution history
   - Event metadata

4. **Smart Contracts** - On-chain components:
   - Oracle Contract: Receives price updates and resolves markets
   - Market Factory Contract: Maps event IDs to market addresses
   - Pyth Contract: Provides price update fees

5. **Matching Engine API** - Receives real-time updates when events are resolved

## Key Features

- **Real-time Price Monitoring**: WebSocket connection to Pyth Network for sub-second price updates
- **Automatic Event Resolution**: Triggers smart contract calls when:
  - Price crosses a defined threshold (GT/LT operators)
  - Event expiration time is reached (resolves as NO)
- **Round-Robin Key Management**: Supports 10 private keys (PRIVATE_KEY_0 through PRIVATE_KEY_9) for parallel transaction submission
- **Duplicate Prevention**: Tracks events being processed to prevent duplicate resolutions
- **Error Handling**: Retries failed resolutions and logs detailed errors
- **Graceful Shutdown**: Handles SIGTERM/SIGINT signals properly

## Configuration

### Required Environment Variables

#### Database
- `DATABASE_URL`: PostgreSQL connection string

#### Blockchain
- `WEB3_PROVIDER_URL`: Ethereum-compatible RPC endpoint (e.g., Arbitrum Sepolia)
- `ORACLE_CONTRACT_ADDRESS`: Address of the Oracle contract
- `MARKET_FACTORY_CONTRACT_ADDRESS`: Address of the Market Factory contract
- `PYTH_CONTRACT_ADDRESS`: Address of the Pyth price feed contract

#### Price Feed
- `PYTH_ENDPOINT`: Pyth Network WebSocket endpoint (default: `https://hermes.pyth.network`)

#### API
- `MATCHING_ENGINE_BASE_URL`: Base URL for the matching engine API

#### Private Keys (at least one required)
- `PRIVATE_KEY_0` through `PRIVATE_KEY_9`: Private keys for transaction signing

### Optional Environment Variables
None currently

## Development

### Prerequisites
- Bun (package manager)
- PostgreSQL database
- Access to Pyth Network price feeds
- Smart contracts deployed on target chain

### Setup

1. Install dependencies:
```bash
bun install
```

2. Set up environment variables in `.env`:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Run Prisma migrations:
```bash
bunx prisma migrate dev
```

4. Build the TypeScript:
```bash
bun run build
```

5. Start the monitoring service:
```bash
bun run start
```

### Testing

Run the test monitor:
```bash
bun run test:monitor
```

## Docker Deployment

### Using Docker Compose

```bash
docker-compose up -d
```

This will start:
- PostgreSQL database
- Market Checker service

### Building Docker Image

```bash
docker build -t market_checker .
```

## How It Works

1. **Initialization**: 
   - PriceMonitor loads active events from the database
   - Subscribes to relevant Pyth price feeds
   - Initializes ContractClient instances for each private key

2. **Price Updates**:
   - Receives real-time price updates via WebSocket
   - Checks each monitored event against the new price
   - If condition is met (price crosses threshold):
     - Marks event as RESOLVING in database
     - Calls smart contract with VAA data
     - Updates event with resolution hash and winning token
     - Notifies matching engine

3. **Expiration Handling**:
   - Checks for expired events during price updates
   - Periodic safety net check every 5 minutes
   - Expired events resolve as NO (losing outcome)

4. **Transaction Management**:
   - Uses round-robin selection of private keys
   - Fetches current nonce and gas price
   - Includes Pyth update fee in transaction value
   - Waits for 1 confirmation before updating database

## Database Schema

Events must have the following fields for auto-resolution:
- `autoResolve`: true
- `pythFeedId`: Pyth Network feed ID (e.g., BTC/USD)
- `triggerPrice`: Price threshold as decimal string
- `operator`: Comparison operator (GT or LT)
- `end_time`: Event expiration timestamp
- `status`: OPEN (will be updated to RESOLVING then RESOLVED)

## Monitoring and Observability

- **Console Logs**: Detailed logging of price updates, condition checks, and contract calls
- **Database State**: Track resolution progress via event status

## Differences from Previous Architecture

**OLD (Removed)**:
- Lambda function for contract interaction
- SQS queue for event messages
- Separate processing pipeline
- LocalStack for local testing

**NEW (Current)**:
- Direct contract calls from checker bot
- Immediate resolution (no queue)
- Single integrated service
- Simpler deployment and monitoring

## Files to Note

### Core Services
- `src/container/PriceMonitor.ts` - Main monitoring logic
- `src/container/ContractClient.ts` - Smart contract interaction
- `src/container/DatabaseClient.ts` - Database operations
- `src/container/PythClient.ts` - Pyth Network WebSocket client

### Deprecated (No Longer Used)
- `src/container/SqsClient.ts` - Old SQS integration
- `src/lambda/*` - Old Lambda function code
- `scripts/deploy-lambda-*.sh` - Lambda deployment scripts
- `scripts/setup-local-aws.sh` - LocalStack setup

## Troubleshooting

### Contract Calls Failing
- Check private key balances (need ETH for gas)
- Verify contract addresses are correct
- Ensure RPC endpoint is accessible
- Check Pyth contract for correct update fee

### Events Not Resolving
- Verify `autoResolve: true` and all required fields are set
- Check that price feed ID matches Pyth Network format
- Ensure event status is OPEN, not RESOLVING/RESOLVED
- Check WebSocket connection to Pyth Network

### Database Connection Issues
- Verify DATABASE_URL format and credentials
- Ensure PostgreSQL is running and accessible
- Check Prisma schema is up to date

## License

[Your License Here]
