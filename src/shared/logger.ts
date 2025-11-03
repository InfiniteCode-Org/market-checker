import os from 'os';
import winston from 'winston';

// Try to load CloudWatch transport if installed
// eslint-disable-next-line @typescript-eslint/no-var-requires
let WinstonCloudWatch: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WinstonCloudWatch = require('winston-cloudwatch');
} catch (_) {
  WinstonCloudWatch = null;
}

const level = process.env.LOG_LEVEL || 'info';

const baseTransports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp as string} ${level}: ${String(message)}${metaStr}`;
      })
    )
  })
];

const logger = winston.createLogger({
  level,
  format: winston.format.json(),
  transports: baseTransports
});

// Optionally add CloudWatch transport when configured
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const logGroupName = process.env.CLOUDWATCH_LOG_GROUP;

if (WinstonCloudWatch && region && logGroupName) {
  const logStreamName = `${process.env.SERVICE_NAME || 'market-checker'}-${process.env.NODE_ENV || 'local'}-${os.hostname()}-${process.pid}`;
  logger.add(new WinstonCloudWatch({
    logGroupName,
    logStreamName,
    awsRegion: region,
    jsonMessage: true
  }));
}

export { logger };


