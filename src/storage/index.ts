import * as fs from 'fs';
import * as nodefs from 'fs/promises';
import * as path from 'path';
import { withLock } from '../utils/lock.js';
import { ensureDir, pathExists } from '../utils/fs.js';
import { Variable, OperationLog, AuditConfig, AuditConfigSchema } from '../types.js';
import * as crypto from 'crypto';
import { encrypt, decrypt } from '../utils/crypto.js';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

export class StorageManager {
  private storePath: string;
  public readonly encrypted: boolean;
  private password?: string;
  private cache: Record<string, Variable> | null = null;
  private maxBackups: number;

  constructor(storePath: string, encrypted: boolean = true, maxBackups: number = 3) {
    this.storePath = storePath;
    this.encrypted = encrypted;
    this.maxBackups = maxBackups;
  }

  setPassword(password: string): void {
    // eslint-disable-next-line security/detect-possible-timing-attacks -- comparing new password value to detect changes, not authenticating
    if (this.password !== password) {
      this.password = password;
      this.cache = null;
    }
  }

  async load(): Promise<Record<string, Variable>> {
    if (this.cache !== null) {
      return this.cache;
    }

    let data: string;
    try {
      const handle = await nodefs.open(this.storePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
          throw new Error(`Storage path is not a regular file: ${this.storePath}`);
        }
        data = await handle.readFile({ encoding: 'utf8' });
      } finally {
        await handle.close();
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = {};
        return this.cache;
      }
      if ((err as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error(`Storage path is not a regular file: ${this.storePath}`);
      }
      throw err;
    }

    if (this.encrypted && this.password) {
      try {
        const decrypted = await decrypt(data, this.password);
        this.cache = JSON.parse(decrypted);
        return this.cache!;
      } catch (error) {
        const restored = await this.tryRestoreFromBackup();
        if (restored !== null) {
          this.cache = restored;
          return this.cache;
        }
        throw new Error('Failed to decrypt storage. Invalid password or corrupted data.', { cause: error });
      }
    }

    this.cache = JSON.parse(data);
    return this.cache!;
  }

  async save(variables: Record<string, Variable>): Promise<void> {
    this.cache = variables;
    const data = this.encrypted
      ? JSON.stringify(variables)
      : JSON.stringify(variables, null, 2);

    const storeDir = path.dirname(this.storePath);
    await ensureDir(storeDir);
    await nodefs.chmod(storeDir, 0o700);

    await withLock(this.storePath, async () => {
      await this.rotateBackups();

      const content = this.encrypted && this.password
        ? await encrypt(data, this.password)
        : data;

      const tmpPath = this.storePath + '.tmp';
      await nodefs.writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
      await nodefs.rename(tmpPath, this.storePath);
      await nodefs.chmod(this.storePath, 0o600);
    });
  }

  private async rotateBackups(): Promise<void> {
    if (this.maxBackups <= 0) return;
    if (!await pathExists(this.storePath)) return;

    for (let i = this.maxBackups; i > 1; i--) {
      const from = `${this.storePath}.bak.${i - 1}`;
      const to = `${this.storePath}.bak.${i}`;
      try {
        await nodefs.rename(from, to);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        /* istanbul ignore else -- non-ENOENT errors during backup rotation are rare */
        if (code !== 'ENOENT') throw err;
      }
    }

    await nodefs.cp(this.storePath, `${this.storePath}.bak.1`);
    await nodefs.chmod(`${this.storePath}.bak.1`, 0o600);
  }

  private async tryRestoreFromBackup(): Promise<Record<string, Variable> | null> {
    /* istanbul ignore if -- password is checked before calling, null case is defensive */
    if (!this.password) return null;

    for (let i = 1; i <= this.maxBackups; i++) {
      const bakPath = `${this.storePath}.bak.${i}`;

      let data: string;
      try {
        data = await nodefs.readFile(bakPath, 'utf8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        continue;
      }

      try {
        const decrypted = await decrypt(data, this.password);
        const variables = JSON.parse(decrypted);

        await nodefs.cp(bakPath, this.storePath);
        await nodefs.chmod(this.storePath, 0o600);
        return variables;
      } catch {
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
    return pathExists(this.storePath);
  }

  invalidateCache(): void {
    this.cache = null;
  }

  async verify(): Promise<{ valid: boolean; error?: string; count?: number; backups?: number }> {
    let data: string;
    try {
      const rh = await nodefs.open(this.storePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { data = await rh.readFile({ encoding: 'utf8' }); } finally { await rh.close(); }
    } catch {
      return { valid: false, error: 'Store file does not exist or cannot be read' };
    }

    if (data.length === 0) {
      return { valid: false, error: 'Store file is empty' };
    }

    try {
      let variables: Record<string, Variable>;
      if (this.encrypted && this.password) {
        const decrypted = await decrypt(data, this.password);
        variables = JSON.parse(decrypted);
      } else {
        variables = JSON.parse(data);
      }

      if (typeof variables !== 'object' || variables === null) {
        return { valid: false, error: 'Store data is not a valid object' };
      }

      let backups = 0;
      for (let i = 1; i <= this.maxBackups; i++) {
        try {
          await nodefs.access(`${this.storePath}.bak.${i}`);
          backups++;
        } catch {
        }
      }

      return { valid: true, count: Object.keys(variables).length, backups };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: `Store verification failed: ${message}` };
    }
  }
}

export interface LogFilter {
  date?: string;
  operation?: string;
  variable?: string;
  source?: string;
  success?: boolean;
  tail?: number;
}

export class LogManager {
  private logDir: string;
  private auditConfig: AuditConfig;
  private hmacKey: Buffer | null = null;
  private lastHmac: string | null = null;
  private chainIndex: number = 0;
  private chainLoaded: boolean = false;

  constructor(logDir: string, auditConfig?: AuditConfig) {
    this.logDir = logDir;
    this.auditConfig = auditConfig ?? AuditConfigSchema.parse({});
  }

  async init(): Promise<void> {
    await ensureDir(this.logDir);
    if (this.auditConfig.hmac) {
      await this.loadOrCreateHmacKey();
    }
    if (this.auditConfig.hmac_chain) {
      await this.loadLastChainState();
    }
    await this.pruneOldLogs(this.auditConfig.retain_days);
  }

  private async loadLastChainState(): Promise<void> {
    if (this.chainLoaded) return;
    
    const dates = await this.getLogDates();
    if (dates.length === 0) {
      this.chainLoaded = true;
      return;
    }

    for (const date of dates.slice().reverse()) {
      const entries = await this.getLogs({ date });
      if (entries.length > 0) {
        const lastEntry = entries[entries.length - 1];
        if (lastEntry.hmac) {
          this.lastHmac = lastEntry.hmac;
        }
        if (lastEntry.chain_index !== undefined) {
          this.chainIndex = lastEntry.chain_index + 1;
        }
        break;
      }
    }
    this.chainLoaded = true;
  }

  private async loadOrCreateHmacKey(): Promise<void> {
    const keyPath = path.join(path.dirname(this.logDir), path.basename(this.auditConfig.hmac_key_path));
    try {
      const raw = await nodefs.readFile(keyPath);
      this.hmacKey = raw;
    } catch {
      const key = crypto.randomBytes(32);
      await ensureDir(path.dirname(keyPath));
      const fh = await nodefs.open(keyPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
      try { await fh.writeFile(key); } finally { await fh.close(); }
      this.hmacKey = key;
    }
  }

  private signEntry(entry: Omit<OperationLog, 'hmac'>, prevHmac?: string): string {
    /* istanbul ignore if -- hmacKey null case is fallback when HMAC disabled */
    if (!this.hmacKey) return crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
    
    const dataToSign = prevHmac 
      ? JSON.stringify({ ...entry, prev_hmac: prevHmac })
      : JSON.stringify(entry);
    return crypto.createHmac('sha256', this.hmacKey).update(dataToSign).digest('hex');
  }

  verifyEntry(entry: OperationLog): boolean {
    if (!this.hmacKey || !entry.hmac) return true;
    
    const { hmac, ...rest } = entry;
    const expected = this.signEntry(rest, entry.prev_hmac);
    try {
      return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  async verifyLogChain(date?: string): Promise<{ valid: boolean; entries: number; tampered: number[] }> {
    if (!this.auditConfig.hmac_chain) {
      return { valid: true, entries: 0, tampered: [] };
    }

    const dates = date ? [date] : await this.getLogDates();
    let totalEntries = 0;
    const tampered: number[] = [];
    let expectedPrevHmac: string | undefined;

    for (const d of dates) {
      const entries = await this.getLogs({ date: d });
      
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        totalEntries++;
        
        if (!this.verifyEntry(entry)) {
          tampered.push(entry.chain_index ?? totalEntries - 1);
          continue;
        }

        if (expectedPrevHmac !== undefined && entry.prev_hmac !== expectedPrevHmac) {
          tampered.push(entry.chain_index ?? totalEntries - 1);
        }

        if (entry.hmac) {
          expectedPrevHmac = entry.hmac;
        }
      }
    }

    return { valid: tampered.length === 0, entries: totalEntries, tampered };
  }

  private applyFieldFilter(entry: OperationLog): OperationLog {
    const f = this.auditConfig.fields;
    const filtered: OperationLog = {
      timestamp: entry.timestamp,
      operation: entry.operation,
      source: entry.source,
      success: entry.success,
    };
    if (f.variable && entry.variable !== undefined) filtered.variable = entry.variable;
    if (f.message && entry.message !== undefined) filtered.message = entry.message;
    if (f.session_id && entry.session_id !== undefined) filtered.session_id = entry.session_id;
    if (f.client_id && entry.client_id !== undefined) filtered.client_id = entry.client_id;
    if (f.client_type && entry.client_type !== undefined) filtered.client_type = entry.client_type;
    if (f.ip && entry.ip !== undefined) filtered.ip = entry.ip;
    if (f.user_agent && entry.user_agent !== undefined) filtered.user_agent = entry.user_agent;
    if (f.purpose && entry.purpose !== undefined) filtered.purpose = entry.purpose;
    if (f.duration_ms && entry.duration_ms !== undefined) filtered.duration_ms = entry.duration_ms;
    if (entry.prev_hmac !== undefined) filtered.prev_hmac = entry.prev_hmac;
    if (entry.chain_index !== undefined) filtered.chain_index = entry.chain_index;
    return filtered;
  }

  async pruneOldLogs(retainDays: number = 30): Promise<void> {
    const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
    let entries: string[];
    try { entries = await nodefs.readdir(this.logDir); } catch { return; }
    for (const entry of entries) {
      if (!entry.startsWith('operations-') || !entry.endsWith('.log')) continue;
      const filePath = path.join(this.logDir, entry);
      try {
        const stat = await nodefs.stat(filePath);
        if (stat.mtimeMs < cutoff) await nodefs.unlink(filePath);
      } catch { /* ignore missing/inaccessible files */ }
    }
  }

  async log(entry: OperationLog): Promise<void> {
    if (!this.auditConfig.enabled) return;

    const filtered = this.applyFieldFilter(entry);

    if (this.auditConfig.hmac && this.hmacKey) {
      if (this.auditConfig.hmac_chain) {
        if (!this.chainLoaded) {
          await this.loadLastChainState();
        }
        if (this.lastHmac) {
          filtered.prev_hmac = this.lastHmac;
        }
        filtered.chain_index = this.chainIndex;
        filtered.hmac = this.signEntry(filtered, filtered.prev_hmac);
        this.lastHmac = filtered.hmac;
        this.chainIndex++;
      } else {
        filtered.hmac = this.signEntry(filtered);
      }
    }

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `operations-${date}.log`);
    await nodefs.appendFile(logFile, JSON.stringify(filtered) + '\n');
  }

  async getLogs(filter: LogFilter = {}): Promise<OperationLog[]> {
    const logDate = filter.date || new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `operations-${logDate}.log`);

    if (!await pathExists(logFile)) return [];

    const content = await nodefs.readFile(logFile, 'utf8');
    let entries: OperationLog[] = content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as OperationLog);

    if (filter.operation) entries = entries.filter(e => e.operation === filter.operation);
    if (filter.variable) entries = entries.filter(e => e.variable === filter.variable);
    if (filter.source) entries = entries.filter(e => e.source === filter.source);
    if (filter.success !== undefined) entries = entries.filter(e => e.success === filter.success);
    if (filter.tail && filter.tail > 0) entries = entries.slice(-filter.tail);

    return entries;
  }

  private async execChattr(filePath: string, flags: string, remove: boolean = false): Promise<boolean> {
    if (process.platform !== 'linux') {
      return false;
    }

    const attr = remove ? flags.replace(/\+/g, '-') : flags;
    try {
      await exec(`chattr ${attr} "${filePath}"`);
      return true;
    } catch {
      return false;
    }
  }

  async setAppendOnly(filePath: string): Promise<boolean> {
    return this.execChattr(filePath, '+a');
  }

  async setImmutable(filePath: string): Promise<boolean> {
    return this.execChattr(filePath, '+i');
  }

  async removeAppendOnly(filePath: string): Promise<boolean> {
    return this.execChattr(filePath, '+a', true);
  }

  async removeImmutable(filePath: string): Promise<boolean> {
    return this.execChattr(filePath, '+i', true);
  }

  async protectLogFiles(): Promise<{ protected: string[]; failed: string[] }> {
    const result = { protected: [] as string[], failed: [] as string[] };
    
    if (this.auditConfig.protection === 'none') {
      return result;
    }

    const dates = await this.getLogDates();
    
    for (const date of dates) {
      const logFile = path.join(this.logDir, `operations-${date}.log`);
      
      let success: boolean;
      if (this.auditConfig.protection === 'append_only') {
        success = await this.setAppendOnly(logFile);
      } else if (this.auditConfig.protection === 'immutable') {
        success = await this.setImmutable(logFile);
      } else {
        continue;
      }

      if (success) {
        result.protected.push(logFile);
      } else {
        result.failed.push(logFile);
      }
    }

    return result;
  }

  async getLogDates(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await nodefs.readdir(this.logDir);
    } catch {
      /* istanbul ignore next -- readdir failure returns empty array */
      entries = [];
    }
    return entries
      .filter(e => e.startsWith('operations-') && e.endsWith('.log'))
      .map(e => e.replace('operations-', '').replace('.log', ''))
      .sort();
  }
}
