import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const ITERATIONS = 100000;
const VERSION_PREFIX = 'v1:';

export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha512');
}

export function encrypt(text: string, password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return VERSION_PREFIX + salt.toString('hex') + iv.toString('hex') + authTag.toString('hex') + encrypted;
}

export function decrypt(encryptedData: string, password: string): string {
  // Strip version prefix if present (backwards-compatible: no prefix = v1)
  const data = encryptedData.startsWith(VERSION_PREFIX)
    ? encryptedData.slice(VERSION_PREFIX.length)
    : encryptedData;
  const salt = Buffer.from(data.slice(0, SALT_LENGTH * 2), 'hex');
  const iv = Buffer.from(data.slice(SALT_LENGTH * 2, SALT_LENGTH * 2 + IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(data.slice(SALT_LENGTH * 2 + IV_LENGTH * 2, SALT_LENGTH * 2 + IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2), 'hex');
  const encrypted = data.slice(SALT_LENGTH * 2 + IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);
  
  const key = deriveKey(password, salt);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

export function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function maskValue(value: string, showLength: number = 4): string {
  if (value.length <= showLength * 2) {
    return '*'.repeat(value.length);
  }
  return value.slice(0, showLength) + '*'.repeat(value.length - showLength * 2) + value.slice(-showLength);
}

export function validatePassword(password: string, config: {
  min_length?: number;
  require_complexity?: boolean;
  allow_numeric_only?: boolean;
  allow_single_char?: boolean;
}): { valid: boolean; error?: string } {
  const minLength = config.min_length ?? 1;
  const requireComplexity = config.require_complexity ?? false;
  const allowNumericOnly = config.allow_numeric_only ?? true;
  const allowSingleChar = config.allow_single_char ?? true;

  if (password.length < minLength) {
    return { valid: false, error: `Password must be at least ${minLength} character(s)` };
  }

  if (!allowSingleChar && password.length === 1) {
    return { valid: false, error: 'Single character passwords are not allowed' };
  }

  if (!allowNumericOnly && /^\d+$/.test(password)) {
    return { valid: false, error: 'Numeric-only passwords are not allowed' };
  }

  if (requireComplexity) {
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    const complexityCount = [hasLower, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;
    
    if (complexityCount < 3) {
      return { valid: false, error: 'Password must contain at least 3 of: lowercase, uppercase, numbers, special characters' };
    }
  }

  return { valid: true };
}

export function quickHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// Recovery key: a random 48-byte hex string (shown to user once)
export function generateRecoveryKey(): string {
  return crypto.randomBytes(24).toString('hex');
}

// Wrap the user's password with the recovery key so it can be recovered later
export function createRecoveryData(password: string, recoveryKey: string): string {
  return encrypt(password, recoveryKey);
}

// Unwrap the password using the recovery key
export function recoverPassword(recoveryData: string, recoveryKey: string): string {
  return decrypt(recoveryData, recoveryKey);
}
