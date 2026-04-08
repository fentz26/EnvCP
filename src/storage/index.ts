import fs from 'fs-extra';
import * as path from 'path';
import { Variable, OperationLog } from '../types.js';
import { encrypt, decrypt } from '../utils/crypto.js';

export class StorageManager {
  private storePath: string;
  private encrypted: boolean;
  private password?: string;
  private cache: Record<string, Variable> | null = null;
  private maxBackups: number;

  constructor(storePath: string, encrypted: boolean = true, maxBackups: number = 3) {
    this.storePath = storePath;
    this.encrypted = encrypted;
    this.maxBackups = maxBackups;
  }

  setPassword(password: string): void {
    if (this.password !== password) {
      this.password = password;
      this.cache = null;
    }
  }

  async load(): Promise<Record<string, Variable>> {
    if (this.cache !== null) {
      return this.cache;
    }

    if (!await fs.pathExists(this.storePath)) {
      this.cache = {};
      return this.cache;
    }

    const data = await fs.readFile(this.storePath, 'utf8');

    if (this.encrypted && this.password) {
      try {
        const decrypted = decrypt(data, this.password);
        this.cache = JSON.parse(decrypted);
        return this.cache!;
      } catch (error) {
        // Try auto-restore from backups
        const restored = await this.tryRestoreFromBackup();
        if (restored !== null) {
          this.cache = restored;
          return this.cache;
        }
        throw new Error('Failed to decrypt storage. Invalid password or corrupted data.');
      }
    }

    this.cache = JSON.parse(data);
    return this.cache!;
  }

  async save(variables: Record<string, Variable>): Promise<void> {
    this.cache = variables;
    const data = JSON.stringify(variables, null, 2);

    await fs.ensureDir(path.dirname(this.storePath));

    // Rotate backups before writing
    await this.rotateBackups();

    const content = this.encrypted && this.password
      ? encrypt(data, this.password)
      : data;

    // Atomic write: write to temp file, then rename
    const tmpPath = this.storePath + '.tmp';
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, this.storePath);
  }

  private async rotateBackups(): Promise<void> {
    if (this.maxBackups <= 0) return;
    if (!await fs.pathExists(this.storePath)) return;

    // Shift existing backups: .bak.2 -> .bak.3, .bak.1 -> .bak.2, etc.
    for (let i = this.maxBackups; i > 1; i--) {
      const from = `${this.storePath}.bak.${i - 1}`;
      const to = `${this.storePath}.bak.${i}`;
      if (await fs.pathExists(from)) {
        await fs.rename(from, to);
      }
    }

    // Copy current store to .bak.1
    await fs.copy(this.storePath, `${this.storePath}.bak.1`);
  }

  private async tryRestoreFromBackup(): Promise<Record<string, Variable> | null> {
    if (!this.encrypted || !this.password) return null;

    for (let i = 1; i <= this.maxBackups; i++) {
      const bakPath = `${this.storePath}.bak.${i}`;
      if (!await fs.pathExists(bakPath)) continue;

      try {
        const data = await fs.readFile(bakPath, 'utf8');
        const decrypted = decrypt(data, this.password);
        const variables = JSON.parse(decrypted);

        // Restore: copy backup to primary store
        await fs.copy(bakPath, this.storePath);
        return variables;
      } catch {
        // This backup is also bad, try next
      }
    }

    return null;
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

  invalidateCache(): void {
    this.cache = null;
  }

  async verify(): Promise<{ valid: boolean; error?: string; count?: number; backups?: number }> {
    let data: string;
    try {
      data = await fs.readFile(this.storePath, 'utf8');
    } catch {
      return { valid: false, error: 'Store file does not exist or cannot be read' };
    }

    if (data.length === 0) {
      return { valid: false, error: 'Store file is empty' };
    }

    try {
      let variables: Record<string, Variable>;
      if (this.encrypted && this.password) {
        const decrypted = decrypt(data, this.password);
        variables = JSON.parse(decrypted);
      } else {
        variables = JSON.parse(data);
      }

      // Verify structure
      if (typeof variables !== 'object' || variables === null) {
        return { valid: false, error: 'Store data is not a valid object' };
      }

      // Count valid backups
      let backups = 0;
      for (let i = 1; i <= this.maxBackups; i++) {
        if (await fs.pathExists(`${this.storePath}.bak.${i}`)) {
          backups++;
        }
      }

      return { valid: true, count: Object.keys(variables).length, backups };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: `Store verification failed: ${message}` };
    }
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
