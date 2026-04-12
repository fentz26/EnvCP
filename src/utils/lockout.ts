import * as fs from 'fs/promises';
import * as path from 'path';
import { ensureDir } from './fs.js';

interface LockoutData {
  attempts: number;
  lockout_count: number;
  locked_until: string | null;
}

const DEFAULT_DATA: LockoutData = { attempts: 0, lockout_count: 0, locked_until: null };

export interface LockoutStatus {
  locked: boolean;
  remaining_seconds: number;
  attempts: number;
}

export class LockoutManager {
  private lockoutPath: string;

  constructor(lockoutPath: string) {
    this.lockoutPath = lockoutPath;
  }

  private async read(): Promise<LockoutData> {
    try {
      const raw = await fs.readFile(this.lockoutPath, 'utf8');
      return { ...DEFAULT_DATA, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_DATA };
    }
  }

  private async write(data: LockoutData): Promise<void> {
    await ensureDir(path.dirname(this.lockoutPath));
    await fs.writeFile(this.lockoutPath, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
  }

  /** Check current lockout status without modifying state. */
  async check(): Promise<LockoutStatus> {
    const data = await this.read();

    if (data.locked_until) {
      const remaining = Math.ceil((new Date(data.locked_until).getTime() - Date.now()) / 1000);
      if (remaining > 0) {
        return { locked: true, remaining_seconds: remaining, attempts: data.attempts };
      }
      // Lockout expired — clear it but preserve lockout_count for exponential backoff
      await this.write({ ...data, locked_until: null, attempts: 0 });
    }

    return { locked: false, remaining_seconds: 0, attempts: data.attempts };
  }

  /**
   * Record a failed attempt. If attempts reach the threshold, impose a lockout
   * whose duration doubles with each successive lockout (exponential backoff).
   */
  async recordFailure(threshold: number = 5, baseSeconds: number = 60): Promise<LockoutStatus> {
    const data = await this.read();
    const attempts = data.attempts + 1;

    if (attempts >= threshold) {
      const cooldown = baseSeconds * Math.pow(2, data.lockout_count);
      const locked_until = new Date(Date.now() + cooldown * 1000).toISOString();
      await this.write({ attempts: 0, lockout_count: data.lockout_count + 1, locked_until });
      return { locked: true, remaining_seconds: cooldown, attempts: 0 };
    }

    await this.write({ ...data, attempts });
    return { locked: false, remaining_seconds: 0, attempts };
  }

  /** Reset all lockout state after a successful unlock. */
  async reset(): Promise<void> {
    try {
      await fs.unlink(this.lockoutPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
