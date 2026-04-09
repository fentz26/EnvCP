import * as crypto from 'crypto';
import argon2 from 'argon2';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// v1 constants (PBKDF2 — kept for backward-compat decryption only)
const SALT_LENGTH = 64;
const ITERATIONS = 100000;
const VERSION_PREFIX_V1 = 'v1:';

// v2 constants (Argon2id)
const V2_SALT_LENGTH = 16;
const VERSION_PREFIX_V2 = 'v2:';

const ARGON2_OPTS = {
  type: argon2.argon2id,
  hashLength: 32,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 1,
  raw: true,
} as const;

/**
 * Derives a 256-bit key from a password and salt using PBKDF2-SHA512.
 * Used only for decrypting legacy v1: data.
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha512');
}

/**
 * Encrypts plaintext using AES-256-GCM with an Argon2id-derived key.
 * Output format: `v2:<salt_hex><iv_hex><authTag_hex><ciphertext_hex>`
 */
export async function encrypt(text: string, password: string): Promise<string> {
  const salt = crypto.randomBytes(V2_SALT_LENGTH);
  const key = await argon2.hash(password, { ...ARGON2_OPTS, salt }) as Buffer;
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return VERSION_PREFIX_V2 + salt.toString('hex') + iv.toString('hex') + authTag.toString('hex') + encrypted;
}

/**
 * Decrypts data produced by `encrypt`.
 * Handles v2: (Argon2id), v1: (PBKDF2), and legacy unprefixed (PBKDF2) data.
 */
export async function decrypt(encryptedData: string, password: string): Promise<string> {
  if (encryptedData.startsWith(VERSION_PREFIX_V2)) {
    return decryptV2(encryptedData.slice(VERSION_PREFIX_V2.length), password);
  }
  // v1: prefix or legacy unprefixed — both use PBKDF2
  const data = encryptedData.startsWith(VERSION_PREFIX_V1)
    ? encryptedData.slice(VERSION_PREFIX_V1.length)
    : encryptedData;
  return decryptV1(data, password);
}

function decryptV1(data: string, password: string): string {
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

async function decryptV2(data: string, password: string): Promise<string> {
  const salt = Buffer.from(data.slice(0, V2_SALT_LENGTH * 2), 'hex');
  const iv = Buffer.from(data.slice(V2_SALT_LENGTH * 2, V2_SALT_LENGTH * 2 + IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(data.slice(V2_SALT_LENGTH * 2 + IV_LENGTH * 2, V2_SALT_LENGTH * 2 + IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2), 'hex');
  const encryptedHex = data.slice(V2_SALT_LENGTH * 2 + IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);

  const key = await argon2.hash(password, { ...ARGON2_OPTS, salt }) as Buffer;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Masks a secret value for display, revealing only the first and last `showLength` characters.
 * Short values are fully masked.
 */
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
export async function createRecoveryData(password: string, recoveryKey: string): Promise<string> {
  return encrypt(password, recoveryKey);
}

// Unwrap the password using the recovery key
export async function recoverPassword(recoveryData: string, recoveryKey: string): Promise<string> {
  return decrypt(recoveryData, recoveryKey);
}
