export const config = {
  pyth: {
    endpoint: process.env.PYTH_ENDPOINT || 'https://hermes.pyth.network',
    reconnectInterval: 5000,
    maxReconnectAttempts: 10
  },
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    sqs: {
      queueUrl: process.env.SQS_QUEUE_URL || ''
    }
  },
  blockchain: {
    providerUrl: process.env.WEB3_PROVIDER_URL || '',
    oracleAddress: process.env.ORACLE_CONTRACT_ADDRESS || '',
    marketAddress: process.env.MARKET_CONTRACT_ADDRESS || '',
    pythAddress: process.env.PYTH_CONTRACT_ADDRESS || '',
    privateKey: process.env.PRIVATE_KEY || '',
    gasPrice: process.env.GAS_PRICE || '50' // gwei
  }
}; 