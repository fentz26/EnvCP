import * as fs from 'fs-extra';
import * as path from 'path';
import { Variable, OperationLog } from '../types.js';
import { encrypt, decrypt } from '../utils/crypto.js';

export class StorageManager {
  private storePath: string;
  private encrypted: boolean;
  private password?: string;

  constructor(storePath: string, encrypted: boolean = true) {
    this.storePath = storePath;
    this.encrypted = encrypted;
  }

  setPassword(password: string): void {
    this.password = password;
  }

  async load(): Promise<Record<string, Variable>> {
    if (!await fs.pathExists(this.storePath)) {
      return {};
    }

    const data = await fs.readFile(this.storePath, 'utf8');
    
    if (this.encrypted && this.password) {
      try {
        const decrypted = decrypt(data, this.password);
        return JSON.parse(decrypted);
      } catch (error) {
        throw new Error('Failed to decrypt storage. Invalid password or corrupted data.');
      }
    }

    return JSON.parse(data);
  }

  async save(variables: Record<string, Variable>): Promise<void> {
    const data = JSON.stringify(variables, null, 2);
    
    await fs.ensureDir(path.dirname(this.storePath));

    if (this.encrypted && this.password) {
      const encryptedData = encrypt(data, this.password);
      await fs.writeFile(this.storePath, encryptedData, 'utf8');
    } else {
      await fs.writeFile(this.storePath, data, 'utf8');
    }
  }

  async get(name: string): Promise<Variable | undefined> {
    const variables = await this.load();
    return variables[name];
  }

  async set(name: string, variable: Variable): Promise<void> {
    const variables = await this.load();
    variables[name] = variable;
    await this.save(variables);
  }

  async delete(name: string): Promise<boolean> {
    const variables = await this.load();
    if (variables[name]) {
      delete variables[name];
      await this.save(variables);
      return true;
    }
    return false;
  }

  async list(): Promise<string[]> {
    const variables = await this.load();
    return Object.keys(variables);
  }

  async exists(): Promise<boolean> {
    return fs.pathExists(this.storePath);
  }
}

export class LogManager {
  private logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
  }

  async init(): Promise<void> {
    await fs.ensureDir(this.logDir);
  }

  async log(entry: OperationLog): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `operations-${date}.log`);
    const logLine = JSON.stringify(entry) + '\n';
    await fs.appendFile(logFile, logLine);
  }

  async getLogs(date?: string): Promise<OperationLog[]> {
    const logDate = date || new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `operations-${logDate}.log`);
    
    if (!await fs.pathExists(logFile)) {
      return [];
    }

    const content = await fs.readFile(logFile, 'utf8');
    return content.trim().split('\n').map(line => JSON.parse(line));
  }
}
