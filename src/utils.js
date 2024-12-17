import Bottleneck from 'bottleneck';
import winston from 'winston';
import path from 'path';
import os from 'os';
import fs from 'fs';

export function setupLogger() {
  const logDir = path.join(os.homedir(), 'receipts', 'logs');

  // Create logs directory if it doesn't exist
  fs.mkdirSync(logDir, { recursive: true });

  const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  );

  const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  );

  return winston.createLogger({
    level: process.env.DEBUG === 'true' ? 'debug' : 'info',
    transports: [
      new winston.transports.Console({
        format: consoleFormat,
        stderrLevels: ['error']
      }),
      new winston.transports.File({ 
        filename: path.join(logDir, 'error.log'), 
        level: 'error',
        format: fileFormat
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'debug.log'),
        level: 'debug',
        format: fileFormat
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