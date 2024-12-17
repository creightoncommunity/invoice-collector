import Bottleneck from 'bottleneck';
import winston from 'winston';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

export async function setupLogger() {
  const logDir = path.join(os.homedir(), 'receipts', 'logs');
  
  // Create session divider
  const sessionDivider = '\n' + '='.repeat(80) + '\n' +
    `Session Started: ${new Date().toISOString()}\n` +
    '='.repeat(80) + '\n';

  // Ensure log directory exists
  await fs.mkdir(logDir, { recursive: true });

  // Append session divider to error log
  await fs.appendFile(
    path.join(logDir, 'error.log'),
    sessionDivider
  );

  return winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} ${level.toUpperCase()}: ${message}\n${JSON.stringify(meta, null, 2)}\n`;
        })
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'debug.log'),
        level: 'debug'
      })
    ]
  });
}

export class RateLimiter {
  constructor(options = {}) {
    this.limiter = new Bottleneck({
      maxConcurrent: options.maxConcurrent || 1,
      minTime: options.minTime || 1000
    });
  }

  schedule(fn) {
    return this.limiter.schedule(fn);
  }
} 