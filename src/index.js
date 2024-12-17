import dotenv from 'dotenv';
import inquirer from 'inquirer';
import { AmazonService } from './amazon.js';
import { setupLogger } from './utils.js';

dotenv.config();

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
  const logger = await setupLogger();
  
  try {
    const service = await selectService();
    
    if (service === 'Exit') {
      process.exit(0);
    }

    if (service === 'Amazon') {
      const amazonService = new AmazonService(logger);
      await amazonService.initialize();
      await amazonService.downloadInvoices();
    }

  } catch (error) {
    logger.error('An error occurred:', { error: error.stack });
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});