import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureDir } from './fs.js';

interface LockoutData {
  attempts: number;
  lockout_count: number;
  permanent_lockout_count: number;
  locked_until: string | null;
  permanent_locked: boolean;
}

const DEFAULT_DATA: LockoutData = { attempts: 0, lockout_count: 0, permanent_lockout_count: 0, locked_until: null, permanent_locked: false };

export interface LockoutStatus {
  locked: boolean;
  permanent_locked: boolean;
  remaining_seconds: number;
  attempts: number;
  lockout_count: number;
  permanent_lockout_count: number;
  delay_seconds?: number;
}

export type LockoutNotificationCallback = (event: {
  type: 'lockout_triggered' | 'permanent_lockout' | 'auth_failure';
  timestamp: string;
  attempts: number;
  lockout_count: number;
  permanent_lockout_count: number;
  remaining_seconds?: number;
  source: 'cli' | 'api' | 'unknown';
  ip?: string;
  user_agent?: string;
}) => void;

export class LockoutManager {
  private readonly lockoutPath: string;
  private readonly notificationCallback?: LockoutNotificationCallback;
  private notificationSource: 'cli' | 'api' | 'unknown' = 'unknown';
  private notificationIp?: string;
  private notificationUserAgent?: string;

  constructor(lockoutPath: string, notificationCallback?: LockoutNotificationCallback) {
    this.lockoutPath = lockoutPath;
    this.notificationCallback = notificationCallback;
  }

  setNotificationSource(source: 'cli' | 'api' | 'unknown', ip?: string, userAgent?: string): void {
    this.notificationSource = source;
    this.notificationIp = ip;
    this.notificationUserAgent = userAgent;
  }

  private sendNotification(type: 'lockout_triggered' | 'permanent_lockout' | 'auth_failure', data: LockoutData, remainingSeconds?: number, attempts?: number): void {
    if (!this.notificationCallback) return;
    
    try {
      this.notificationCallback({
        type,
        timestamp: new Date().toISOString(),
        attempts: attempts ?? /* c8 ignore next */ data.attempts,
        lockout_count: data.lockout_count,
        permanent_lockout_count: data.permanent_lockout_count,
        remaining_seconds: remainingSeconds,
        source: this.notificationSource,
        ip: this.notificationIp,
        user_agent: this.notificationUserAgent
      });
    } catch {
      // Silently ignore notification errors
    }
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

    // Check permanent lockout first
    if (data.permanent_locked) {
      return { 
        locked: true, 
        permanent_locked: true, 
        remaining_seconds: 0, 
        attempts: data.attempts,
        lockout_count: data.lockout_count,
        permanent_lockout_count: data.permanent_lockout_count
      };
    }

    if (data.locked_until) {
      const remaining = Math.ceil((new Date(data.locked_until).getTime() - Date.now()) / 1000);
      if (remaining > 0) {
        return { 
          locked: true, 
          permanent_locked: false,
          remaining_seconds: remaining, 
          attempts: data.attempts,
          lockout_count: data.lockout_count,
          permanent_lockout_count: data.permanent_lockout_count
        };
      }
      // Lockout expired — clear it but preserve lockout_count for exponential backoff
      await this.write({ ...data, locked_until: null, attempts: 0 });
    }

    return { 
      locked: false, 
      permanent_locked: false,
      remaining_seconds: 0, 
      attempts: data.attempts,
      lockout_count: data.lockout_count,
      permanent_lockout_count: data.permanent_lockout_count
    };
  }

  /**
   * Record a failed attempt with progressive delays and permanent lockout support.
   * @param threshold - Number of attempts before lockout
   * @param baseSeconds - Base lockout duration in seconds
   * @param progressiveDelay - Whether to apply progressive delays before lockout
   * @param maxDelay - Maximum progressive delay in seconds (0 to disable)
   * @param permanentThreshold - Permanent lockout threshold (0 to disable)
   */
  async recordFailure(
    threshold: number = 5, 
    baseSeconds: number = 60,
    progressiveDelay: boolean = false,
    maxDelay: number = 0,
    permanentThreshold: number = 0
  ): Promise<LockoutStatus> {
    const data = await this.read();
    
    // Check for permanent lockout first
    if (data.permanent_locked) {
      return { 
        locked: true, 
        permanent_locked: true,
        remaining_seconds: 0, 
        attempts: data.attempts,
        lockout_count: data.lockout_count,
        permanent_lockout_count: data.permanent_lockout_count
      };
    }

    const attempts = data.attempts + 1;
    let delaySeconds: number | undefined = undefined;

    // Apply progressive delay if enabled and not at threshold yet
    if (progressiveDelay && attempts < threshold && maxDelay > 0) {
      // Calculate progressive delay: 2^(attempts-1) seconds, capped at maxDelay
      delaySeconds = Math.min(Math.pow(2, attempts - 1), maxDelay);
    }

    // Check for permanent lockout threshold
    if (permanentThreshold > 0 && data.permanent_lockout_count >= permanentThreshold) {
      await this.write({ 
        ...data, 
        attempts: 0, 
        permanent_locked: true,
        locked_until: null
      });
      
      this.sendNotification('permanent_lockout', data, undefined, attempts);
      
      return { 
        locked: true, 
        permanent_locked: true,
        remaining_seconds: 0, 
        attempts: 0,
        lockout_count: data.lockout_count,
        permanent_lockout_count: data.permanent_lockout_count
      };
    }

    if (attempts >= threshold) {
      const cooldown = baseSeconds * Math.pow(2, data.lockout_count);
      const locked_until = new Date(Date.now() + cooldown * 1000).toISOString();
      const newPermanentCount = data.permanent_lockout_count + 1;
      
      await this.write({ 
        attempts: 0, 
        lockout_count: data.lockout_count + 1, 
        permanent_lockout_count: newPermanentCount,
        locked_until,
        permanent_locked: false
      });
      
      this.sendNotification('lockout_triggered', data, cooldown, attempts);
      
      return { 
        locked: true, 
        permanent_locked: false,
        remaining_seconds: cooldown, 
        attempts: 0,
        lockout_count: data.lockout_count + 1,
        permanent_lockout_count: newPermanentCount
      };
    }

    await this.write({ ...data, attempts });
    
    // Send auth failure notification
    this.sendNotification('auth_failure', data, undefined, attempts);
    
    const result: LockoutStatus = { 
      locked: false, 
      permanent_locked: false,
      remaining_seconds: 0, 
      attempts,
      lockout_count: data.lockout_count,
      permanent_lockout_count: data.permanent_lockout_count
    };
    
    if (delaySeconds !== undefined) {
      result.delay_seconds = delaySeconds;
    }
    
    return result;
  }

  /** Reset all lockout state after a successful unlock. */
  async reset(): Promise<void> {
    try {
      await fs.unlink(this.lockoutPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  /** Clear permanent lockout (requires recovery key or admin action). */
  async clearPermanentLockout(): Promise<void> {
    const data = await this.read();
    if (data.permanent_locked) {
      await this.write({ 
        ...data, 
        permanent_locked: false,
        attempts: 0,
        locked_until: null,
        // Keep lockout_count for exponential backoff memory
      });
    }
  }

  /** Get detailed lockout statistics. */
  async getStats(): Promise<{
    attempts: number;
    lockout_count: number;
    permanent_lockout_count: number;
    permanent_locked: boolean;
    locked_until: string | null;
  }> {
    const data = await this.read();
    return {
      attempts: data.attempts,
      lockout_count: data.lockout_count,
      permanent_lockout_count: data.permanent_lockout_count,
      permanent_locked: data.permanent_locked,
      locked_until: data.locked_until
    };
  }
}
