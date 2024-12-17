import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export class Storage {
  constructor(platform) {
    this.baseDir = path.join(os.homedir(), 'receipts');
    this.platform = platform;
    this.historyFile = path.join(this.baseDir, platform, 'history.json');
    this.receiptsDir = path.join(this.baseDir, platform);
  }

  async initialize() {
    await fs.mkdir(this.receiptsDir, { recursive: true });
    
    try {
      await fs.access(this.historyFile);
    } catch {
      await this.saveHistory({ 
        lastSyncDate: null,
        downloadedInvoices: {},
        lastRunDate: null
      });
    }
  }

  async getHistory() {
    try {
      const data = await fs.readFile(this.historyFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  async saveHistory(history) {
    await fs.writeFile(this.historyFile, JSON.stringify(history, null, 2));
  }

  async saveInvoice(orderId, data, orderDate) {
    const datePrefix = new Date().toISOString().split('T')[0];
    const fileName = `${datePrefix}_${this.platform}_${orderId}.pdf`;
    
    await fs.writeFile(path.join(this.receiptsDir, fileName), data);
    
    const history = await this.getHistory();
    history.downloadedInvoices[orderId] = {
      fileName,
      downloadDate: datePrefix,
      orderDate
    };
    await this.saveHistory(history);
    
    return fileName;
  }

  async isInvoiceDownloaded(orderId) {
    const history = await this.getHistory();
    return !!history.downloadedInvoices[orderId];
  }
} 