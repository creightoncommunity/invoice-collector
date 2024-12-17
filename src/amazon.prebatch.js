import puppeteer from 'puppeteer';
import inquirer from 'inquirer';
import { Storage } from './storage.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { setupLogger } from './utils.js';

const logger = setupLogger();

const navigationPaths = {
  search: {
    legacy: 'https://www.amazon.com/gp/legacy/order-history',
    modern: 'https://www.amazon.com/gp/your-account/order-history'
  },
  invoice: {
    print: 'https://www.amazon.com/gp/css/summary/print.html',
    details: 'https://www.amazon.com/gp/your-account/order-details'
  }
};

export class AmazonService {
  constructor(rateLimiter) {
    this.storage = new Storage('amazon');
    this.rateLimiter = rateLimiter;
    this.browser = null;
    this.page = null;
    this.debug = process.env.DEBUG === 'true';
  }

  async initialize() {
    await this.storage.initialize();
    
    this.browser = await puppeteer.launch({ 
      headless: false,
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--profile-directory=Default'
      ],
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      channel: 'chrome'
    });
    
    this.page = await this.browser.newPage();
    
    // Set up page event listeners after page is created
    if (this.debug) {
      this.page.on('console', msg => logger.debug('Browser console:', {
        type: msg.type(),
        text: msg.text()
      }));

      this.page.on('request', request => {
        logger.debug('Navigation Request:', {
          timestamp: new Date().toLocaleString(),
          url: request.url(),
          method: request.method(),
          headers: request.headers()
        });
      });

      this.page.on('response', async response => {
        try {
          logger.debug('Navigation Response:', {
            timestamp: new Date().toLocaleString(),
            url: response.url(),
            status: response.status(),
            headers: response.headers()
          });
        } catch (error) {
          logger.debug('Could not capture response', {
            url: response.url(),
            error: error.message
          });
        }
      });
    }

    await this.authenticate();
  }

  async authenticate() {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        // Try going directly to orders page
        await this.page.goto('https://www.amazon.com/gp/your-account/order-history', {
          waitUntil: 'networkidle0',
          timeout: 30000
        });
        
        // Check if we landed on a sign-in page or orders page
        const onSignInPage = await this.page.evaluate(() => {
          const url = window.location.href;
          return url.includes('/ap/signin') || !url.includes('order-history');
        });
        
        if (!onSignInPage) {
          // Look for elements that indicate we're on the orders page
          const ordersElement = await this.page.$('.order, [class*="order-card"], #orderTypeMenuContainer');
          if (ordersElement) {
            console.log('Session valid, proceeding with existing login...');
            return;
          }
        }
        
        console.log('Please log in to Amazon in the browser window...');
        // Wait for successful login and redirect to orders page
        await this.page.waitForFunction(
          () => {
            return window.location.href.includes('order-history') &&
              !!document.querySelector('.order, [class*="order-card"], #orderTypeMenuContainer');
          },
          { timeout: 300000 } // 5 minute timeout for login
        );
        console.log('Login successful!');
        return;
      } catch (error) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error('Authentication check failed:', error);
          throw new Error('Failed to verify Amazon login status');
        }
        console.log(`Retry attempt ${retryCount}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  async downloadInvoices() {
    let currentPage = 0;
    
    while (true) {
      try {
        console.clear();
        await fs.writeFile(path.join(os.homedir(), 'receipts', 'logs', 'debug.log'), '');
        
        const startIndex = currentPage * 10;
        const ordersUrl = new URL('https://www.amazon.com/gp/your-account/order-history');
        ordersUrl.searchParams.set('startIndex', startIndex.toString());
        
        await this.page.goto(ordersUrl.toString(), { waitUntil: 'networkidle0', timeout: 30000 });

        // Get orders and last order date
        const { orders, lastOrderDate } = await this.page.evaluate(() => {
          const orders = Array.from(document.querySelectorAll('[class*="order-card"]')).map(order => ({
            orderId: order.querySelector('[data-order-id]')?.getAttribute('data-order-id') || 
                    order.querySelector('a[href*="order-details"]')?.getAttribute('href')?.match(/orderID=([^&]+)/)?.[1],
            orderDate: order.querySelector('.a-color-secondary.value, .value, [class*="order-date"]')?.textContent?.trim() || 'Date not found',
            total: order.querySelector('[class*="order-total"]')?.textContent?.trim()
              ?.replace(/\s+/g, ' ')
              ?.replace('Total ', '') || 'Total not found',
            items: Array.from(order.querySelectorAll('.a-link-normal[href*="/gp/product/"]'))
              .map(item => item.textContent.trim())
              .filter(text => text && !text.includes('<img'))
          }));

          return { 
            orders, 
            lastOrderDate: orders[orders.length - 1]?.orderDate 
          };
        });

        // Display orders
        console.log('\n=== Amazon Orders ===\n');
        
        orders.forEach((order, index) => {
          console.log(`${(index + 1).toString().padStart(2, ' ')}. ${order.total.padEnd(10)} - ${order.items[0].substring(0, 60)}${order.items[0].length > 60 ? '...' : ''}`);
          if (order.items.length > 1) {
            console.log(`    + ${order.items.length - 1} more items`);
          }
        });

        // Display footer
        console.log('\n' + '─'.repeat(80));
        
        if (lastOrderDate) {
          console.log(`Last order on this page: ${lastOrderDate}`);
          console.log();
        }

        // Generate pagination display
        const startPage = Math.floor(currentPage / 10) * 10 + 1;
        const pages = Array.from({ length: 10 }, (_, i) => startPage + i);
        const paginationLine = pages
          .map(pageNum => {
            if (pageNum === currentPage + 1) {
              return `\x1b[36m${pageNum.toString().padStart(3)}\x1b[0m`;
            }
            return pageNum.toString().padStart(3);
          })
          .join(' ');
        
        console.log(`Pages: ${paginationLine}`);

        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'Choose an action:',
            choices: [
              { name: 'Select orders to download', value: 'select' },
              { name: 'Go to page...', value: 'goto' },
              new inquirer.Separator(),
              { name: 'Next page', value: 'next', disabled: orders.length < 10 },
              { name: 'Previous page', value: 'prev', disabled: currentPage === 0 },
              { name: 'Exit application', value: 'exit' }
            ]
          }
        ]);

        if (action === 'goto') {
          const { pageNumber } = await inquirer.prompt([
            {
              type: 'input',
              name: 'pageNumber',
              message: 'Enter page number:',
              validate: (input) => {
                const num = parseInt(input);
                if (isNaN(num) || num < 1) {
                  return 'Please enter a valid page number';
                }
                return true;
              },
              filter: (input) => parseInt(input) - 1
            }
          ]);
          currentPage = pageNumber;
          continue;
        }

        switch (action) {
          case 'next':
            currentPage++;
            continue;
          
          case 'prev':
            currentPage = Math.max(0, currentPage - 1);
            continue;
          
          case 'exit':
            console.log('\nGoodbye!');
            process.exit(0);
        }

        // Handle order selection and download...

      } catch (error) {
        logger.error('Error processing orders:', {
          error: error.message,
          stack: error.stack
        });
        console.error('\nAn error occurred. Press any key to retry or Ctrl+C to exit.');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  async downloadInvoice(orderId, orderDate, retryCount = 0) {
    const maxRetries = 3;
    const startTime = Date.now();
    
    try {
      logger.debug('🚀 Starting PDF capture', {
        timestamp: new Date().toLocaleString(),
        orderId,
        attempt: retryCount + 1,
        maxRetries
      });

      const invoiceUrl = new URL('https://www.amazon.com/gp/css/summary/print.html');
      invoiceUrl.searchParams.set('orderID', orderId);
      
      logger.debug('📄 Navigation starting', {
        timestamp: new Date().toLocaleString(),
        url: invoiceUrl.toString()
      });

      // Add timeout promise
      const navigationPromise = this.page.goto(invoiceUrl.toString(), {
        waitUntil: 'networkidle0',
        timeout: 45000  // Increased timeout
      });

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Navigation timeout')), 50000)
      );

      await Promise.race([navigationPromise, timeoutPromise]);

      // Verify we're on the right page
      const currentUrl = this.page.url();
      if (!currentUrl.includes('summary/print.html')) {
        throw new Error(`Invalid navigation: ${currentUrl}`);
      }

      // Small delay to ensure page is ready
      await new Promise(resolve => setTimeout(resolve, 2000));

      logger.debug('Initiating PDF capture');
      const pdf = await this.page.pdf({
        scale: 0.5,
        format: 'A4',
        printBackground: true,
        timeout: 30000
      });
      
      logger.debug('✅ PDF captured successfully', {
        timestamp: new Date().toLocaleString(),
        bytes: pdf.length,
        duration: `${Date.now() - startTime}ms`
      });
      
      return await this.storage.saveInvoice(orderId, pdf, orderDate);

    } catch (error) {
      logger.error('❌ Invoice capture failed', {
        timestamp: new Date().toLocaleString(),
        orderId,
        error: error.message,
        attempt: retryCount + 1,
        duration: `${Date.now() - startTime}ms`
      });

      // Retry logic
      if (retryCount < maxRetries) {
        console.log(`\nRetrying download (${retryCount + 2}/${maxRetries + 1})...`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
        return this.downloadInvoice(orderId, orderDate, retryCount + 1);
      }

      throw error;
    }
  }

  async isPageBlocked() {
    return await this.page.evaluate(() => {
      const bodyText = document.body.textContent;
      return bodyText.includes('Type the characters you see in this image') ||
             bodyText.includes('Sorry, we just need to make sure you\'re not a robot');
    });
  }

  async simulateHumanBehavior() {
    // Random scroll
    await this.page.evaluate(() => {
      window.scrollTo({
        top: Math.random() * document.body.scrollHeight,
        behavior: 'smooth'
      });
    });
    
    // Random wait
    await new Promise(resolve => 
      setTimeout(resolve, Math.random() * 2000 + 1000)
    );
  }
} 