import dotenv from 'dotenv';
import inquirer from 'inquirer';
import { AmazonService } from './amazon.js';
import { setupLogger, RateLimiter } from './utils.js';

dotenv.config();

const logger = setupLogger();
const rateLimiter = new RateLimiter({
  maxConcurrent: 1,
  minTime: 1000
});

async function selectService() {
  const { service } = await inquirer.prompt([
    {
      type: 'list',
      name: 'service',
      message: 'Select the e-commerce platform:',
      choices: ['Amazon', 'Exit']
    }
  ]);
  return service;
}

async function main() {
  try {
    const service = await selectService();
    
    if (service === 'Exit') {
      process.exit(0);
    }

    if (service === 'Amazon') {
      const amazonService = new AmazonService(rateLimiter);
      await amazonService.initialize();
      await amazonService.downloadInvoices();
    }

  } catch (error) {
    logger.error('An error occurred:', error);
    process.exit(1);
  }
}

main();