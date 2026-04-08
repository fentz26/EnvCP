import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const ITERATIONS = 100000;

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
  
  return salt.toString('hex') + iv.toString('hex') + authTag.toString('hex') + encrypted;
}

export function decrypt(encryptedData: string, password: string): string {
  const salt = Buffer.from(encryptedData.slice(0, SALT_LENGTH * 2), 'hex');
  const iv = Buffer.from(encryptedData.slice(SALT_LENGTH * 2, SALT_LENGTH * 2 + IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(encryptedData.slice(SALT_LENGTH * 2 + IV_LENGTH * 2, SALT_LENGTH * 2 + IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2), 'hex');
  const encrypted = encryptedData.slice(SALT_LENGTH * 2 + IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);
  
  const key = deriveKey(password, salt);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function maskValue(value: string, showLength: number = 4): string {
  if (value.length <= showLength * 2) {
    return '*'.repeat(value.length);
  }
  return value.slice(0, showLength) + '*'.repeat(value.length - showLength * 2) + value.slice(-showLength);
}

export function obfuscate(value: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < value.length; i++) {
    if (Math.random() > 0.7) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    } else {
      result += '*';
    }
  }
  return result;
}
