import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { watch, type FSWatcher } from 'fs';
import { EnvCPConfig } from '../types.js';
import { loadConfig } from './manager.js';
import { getGlobalVaultPath } from '../vault/index.js';

const DEBOUNCE_MS = 1000;
const PERIODIC_CHECK_MS = 60_000;

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item);
    }
  } else {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(value);
    }
  }
  return obj;
}

export interface ConfigGuardOptions {
  periodicCheckMs?: number;
  debounceMs?: number;
}

export class ConfigGuard {
  private config: EnvCPConfig | null = null;
  private configHash: string | null = null;
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private tamperingDetected = false;
  private lastInternalWriteMs = 0;
  private projectPath: string;
  private logPath: string;
  private options: ConfigGuardOptions;

  constructor(projectPath: string, options?: ConfigGuardOptions) {
    this.projectPath = projectPath;
    this.logPath = path.join(projectPath, '.envcp', 'logs', 'audit.log');
    this.options = options ?? {};
  }

  async loadAndLock(): Promise<EnvCPConfig> {
    const config = await loadConfig(this.projectPath);
    this.config = deepFreeze(config);
    this.configHash = await this.hashConfigFile();
    this.startWatching();
    this.startPeriodicCheck();
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
    const currentConfig = this.config ?? await loadConfig(this.projectPath);
    const storePath = path.join(this.projectPath, currentConfig.storage.path || '.envcp/store.enc');

    if (currentConfig.storage.encrypted !== false) {
      try {
        const encrypted = await fs.promises.readFile(storePath, 'utf8');
        const { decrypt } = await import('../utils/crypto.js');
        await decrypt(encrypted, password);
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
          // Store file doesn't exist yet — no password verification needed
        } else {
          return { success: false, error: 'Invalid password' };
        }
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
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  private async hashConfigFile(): Promise<string> {
    const configPath = path.join(this.projectPath, 'envcp.yaml');
    const globalPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.envcp', 'config.yaml'
    );

    const pathsToHash = [globalPath, configPath];

    // Include global vault store in integrity hash if config is loaded
    if (this.config) {
      pathsToHash.push(getGlobalVaultPath(this.config));
    }

    const hashes: string[] = [];
    for (const p of pathsToHash) {
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

    const filesToWatch = [globalPath, configPath];

    // Watch global vault store file for tampering
    if (this.config) {
      filesToWatch.push(getGlobalVaultPath(this.config));
    }

    for (const filePath of filesToWatch) {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) continue;

        const watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
          if (filename === path.basename(filePath)) {
            this.handleChange(filePath);
          }
        });
        watcher.on('error', () => { /* ignore */ });
        this.watchers.push(watcher);
      } catch { /* ignore */ }
    }
  }

  private handleChange(filePath: string): void {
    if (Date.now() - this.lastInternalWriteMs < 500) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.verifyAndAlert(filePath);
    }, this.options.debounceMs ?? DEBOUNCE_MS);
  }

  private startPeriodicCheck(): void {
    const intervalMs = this.options.periodicCheckMs ?? PERIODIC_CHECK_MS;
    this.periodicTimer = setInterval(async () => {
      const intact = await this.checkIntegrity();
      if (!intact && !this.tamperingDetected) {
        this.tamperingDetected = true;
        const timestamp = new Date().toISOString();
        const message = `[${timestamp}] SECURITY WARNING: Periodic integrity check detected config tampering`;
        if (process.stderr.isTTY) {
          process.stderr.write(`\n${'='.repeat(60)}\n`);
          process.stderr.write(`${message}\n`);
          process.stderr.write(`Run: envcp config reload (requires password)\n`);
          process.stderr.write(`${'='.repeat(60)}\n\n`);
        }
        await this.auditLog('PERIODIC_TAMPER', message);
      }
    }, intervalMs);
    /* c8 ignore next -- setInterval always returns a Timeout with .unref() in Node.js; the else branch is unreachable */
    if (this.periodicTimer && typeof this.periodicTimer === 'object' && 'unref' in this.periodicTimer) {
      this.periodicTimer.unref();
    }
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
