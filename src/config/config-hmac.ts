import * as crypto from 'crypto';
import * as os from 'os';

const HMAC_ALGORITHM = 'sha256';
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_SALT = 'envcp-config-hmac-v1';

export function generateConfigHmac(configContent: string, key: string): string {
  const hmac = crypto.createHmac(HMAC_ALGORITHM, key);
  hmac.update(configContent);
  const digest = hmac.digest('hex');
  return `sha256:${digest}`;
}

export function verifyConfigHmac(configContent: string, hmac: string, key: string): boolean {
  if (!hmac.startsWith('sha256:')) return false;
  const expected = generateConfigHmac(configContent, key);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hmac));
}

export function deriveHmacKey(password: string): string {
  const salt = Buffer.from(PBKDF2_SALT, 'utf8');
  const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, 'sha512');
  return derived.toString('hex');
}

export function getSystemIdentifier(): string {
  const username = process.env.USER || process.env.USERNAME || process.env.LOGNAME || 'unknown';
  const hostname = os.hostname();
  return `${username}@${hostname}`;
}
