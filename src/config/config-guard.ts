import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { watch, type FSWatcher } from 'fs';
import { EnvCPConfig } from '../types.js';
import { loadConfig } from './manager.js';

const DEBOUNCE_MS = 1000;
const DELETION_GRACE_MS = 1700;

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

export class ConfigGuard {
  private config: EnvCPConfig | null = null;
  private configHash: string | null = null;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private deletionTimer: ReturnType<typeof setTimeout> | null = null;
  private tamperingDetected = false;
  private lastInternalWriteMs = 0;
  private projectPath: string;
  private logPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.logPath = path.join(projectPath, '.envcp', 'logs', 'audit.log');
  }

  async loadAndLock(): Promise<EnvCPConfig> {
    const config = await loadConfig(this.projectPath);
    this.config = deepFreeze(config);
    this.configHash = await this.hashConfigFile();
    this.startWatching();
    return this.config;
  }

  getConfig(): EnvCPConfig | null {
    return this.config;
  }

  getHash(): string | null {
    return this.configHash;
  }

  isTampered(): boolean {
    return this.tamperingDetected;
  }

  markInternalWrite(): void {
    this.lastInternalWriteMs = Date.now();
  }

  async reload(password: string): Promise<{ success: boolean; config?: EnvCPConfig; error?: string }> {
    const storePath = path.join(this.projectPath, this.config?.storage.path || '.envcp/store.enc');

    if (this.config?.storage.encrypted !== false) {
      try {
        const { decrypt } = await import('../utils/crypto.js');
        const encrypted = await fs.promises.readFile(storePath, 'utf8');
        await decrypt(encrypted, password);
      } catch {
        return { success: false, error: 'Invalid password' };
      }
    }

    const newConfig = await loadConfig(this.projectPath);
    this.config = deepFreeze(newConfig);
    this.configHash = await this.hashConfigFile();
    this.tamperingDetected = false;

    await this.auditLog('CONFIG_RELOAD', 'Config reloaded successfully (authenticated)');

    return { success: true, config: this.config };
  }

  async checkIntegrity(): Promise<boolean> {
    const currentHash = await this.hashConfigFile();
    if (currentHash !== this.configHash) {
      return false;
    }
    return true;
  }

  destroy(): void {
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* ignore */ }
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.deletionTimer) {
      clearTimeout(this.deletionTimer);
      this.deletionTimer = null;
    }
  }

  private async hashConfigFile(): Promise<string> {
    const configPath = path.join(this.projectPath, 'envcp.yaml');
    const globalPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.envcp', 'config.yaml'
    );

    const hashes: string[] = [];
    for (const p of [globalPath, configPath]) {
      try {
        const content = await fs.promises.readFile(p, 'utf8');
        hashes.push(crypto.createHash('sha256').update(content).digest('hex'));
      } catch {
        hashes.push('missing');
      }
    }
    return crypto.createHash('sha256').update(hashes.join('|')).digest('hex');
  }

  private startWatching(): void {
    const configPath = path.join(this.projectPath, 'envcp.yaml');
    const globalPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.envcp', 'config.yaml'
    );

    for (const filePath of [globalPath, configPath]) {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) continue;

        const watcher = watch(dir, { persistent: false }, (eventType, filename) => {
          if (filename === path.basename(filePath)) {
            this.handleChange(filePath);
          }
        });
        watcher.on('error', () => { /* ignore */ });

        if (filePath === configPath) {
          this.watcher = watcher;
        }
      } catch { /* ignore */ }
    }
  }

  private handleChange(filePath: string): void {
    if (Date.now() - this.lastInternalWriteMs < 500) return;

    if (this.deletionTimer) {
      clearTimeout(this.deletionTimer);
      this.deletionTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.verifyAndAlert(filePath);
    }, DEBOUNCE_MS);
  }

  private async verifyAndAlert(filePath: string): Promise<void> {
    const currentHash = await this.hashConfigFile();
    if (currentHash === this.configHash) return;

    this.tamperingDetected = true;

    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] SECURITY WARNING: Config file modified at runtime: ${filePath}`;

    if (process.stderr.isTTY) {
      process.stderr.write(`\n${'='.repeat(60)}\n`);
      process.stderr.write(`${message}\n`);
      process.stderr.write(`Continuing with locked (safe) config from startup.\n`);
      process.stderr.write(`To apply changes: envcp config reload (requires password)\n`);
      process.stderr.write(`${'='.repeat(60)}\n\n`);
    }

    await this.auditLog('CONFIG_TAMPER', message);
  }

  private async auditLog(operation: string, detail: string): Promise<void> {
    try {
      const logDir = path.dirname(this.logPath);
      await fs.promises.mkdir(logDir, { recursive: true });
      const line = `${new Date().toISOString()} ${operation} ${detail}\n`;
      await fs.promises.appendFile(this.logPath, line, 'utf8');
    } catch { /* ignore */ }
  }
}
