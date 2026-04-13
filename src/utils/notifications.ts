import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

export interface NotificationConfig {
  webhook_url?: string;
  email?: string;
}

export interface LockoutEvent {
  type: 'lockout_triggered' | 'permanent_lockout' | 'auth_failure';
  timestamp: string;
  attempts: number;
  lockout_count: number;
  permanent_lockout_count: number;
  remaining_seconds?: number;
  source: 'cli' | 'api' | 'unknown';
  ip?: string;
  user_agent?: string;
  vault_path: string;
}

export class NotificationManager {
  private config: NotificationConfig;
  private vaultPath: string;

  constructor(config: NotificationConfig, vaultPath: string) {
    this.config = config;
    this.vaultPath = vaultPath;
  }

  async sendLockoutNotification(event: Omit<LockoutEvent, 'vault_path'>): Promise<void> {
    // Always skip notifications in test/CI environment
    if (process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
      return;
    }

    const fullEvent: LockoutEvent = {
      ...event,
      vault_path: this.vaultPath
    };

    const promises: Promise<void>[] = [];

    if (this.config.webhook_url) {
      promises.push(this.sendWebhook(fullEvent));
    }

    if (this.config.email) {
      promises.push(this.sendEmail(fullEvent));
    }

    // Fire and forget - don't block on notification failures
    Promise.allSettled(promises).catch(() => {
      // Silently ignore notification failures
    });
  }

  private async sendWebhook(event: LockoutEvent): Promise<void> {
    if (!this.config.webhook_url) return;
    
    // Skip webhook in test environment to avoid hanging tests
    if (process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
      return;
    }

    const url = new URL(this.config.webhook_url);
    const isHttps = url.protocol === 'https:';
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'EnvCP/1.0',
        'X-EnvCP-Event': event.type,
        'X-EnvCP-Timestamp': event.timestamp,
      }
    };

    const data = JSON.stringify({
      event: event.type,
      timestamp: event.timestamp,
      vault: this.vaultPath,
      details: {
        attempts: event.attempts,
        lockout_count: event.lockout_count,
        permanent_lockout_count: event.permanent_lockout_count,
        remaining_seconds: event.remaining_seconds,
        source: event.source,
        ip: event.ip,
        user_agent: event.user_agent
      }
    });

    return new Promise((resolve) => {
      const req = (isHttps ? https : http).request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            // Don't reject - just log silently
            resolve();
          }
        });
      });

      req.on('error', () => {
        // Don't reject - just log silently
        resolve();
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve(); // Timeout is not a critical failure
      });

      req.write(data);
      req.end();
    });
  }

  private async sendEmail(event: LockoutEvent): Promise<void> {
    if (!this.config.email) return;
    
    // Skip email in test environment
    if (process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
      return;
    }

    // Email notification requires SMTP configuration
    // For now, we'll just log that email notification would be sent
    // In a real implementation, this would use nodemailer or similar
    
    console.warn(`[EnvCP] Email notification for ${event.type} would be sent to ${this.config.email}`);
    console.warn(`[EnvCP] SMTP configuration not implemented yet. Event: ${JSON.stringify(event, null, 2)}`);
    
    // Placeholder for future SMTP implementation
    return Promise.resolve();
  }

  /**
   * Create a secure signature for webhook payload verification
   */
  static createSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Verify a webhook signature
   */
  static verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = this.createSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  }
}