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

// Common weak passwords that should always be rejected regardless of policy.
// These are the top entries from breached-password databases that would fall
// within an 8+ char minimum.
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789',
  '1234567890', 'qwerty123', 'abcdefgh', 'abcd1234', 'iloveyou',
  'sunshine1', 'princess1', 'football1', 'charlie1', 'access14',
  'master123', 'dragon123', 'monkey123', 'letmein123', 'trustno1',
  'baseball1', 'shadow123', 'michael1', 'jennifer1', 'superman1',
  'qwertyui', 'asdfghjk', 'zxcvbnm1', 'passw0rd', 'p@ssw0rd',
  'welcome1', 'admin123', 'changeme', 'test1234', 'guest1234',
]);

export function validatePassword(password: string, config: {
  min_length?: number;
  require_complexity?: boolean;
  allow_numeric_only?: boolean;
  allow_single_char?: boolean;
}): { valid: boolean; error?: string; warning?: string } {
  const minLength = config.min_length ?? 8;
  const requireComplexity = config.require_complexity ?? false;
  const allowNumericOnly = config.allow_numeric_only ?? false;
  const allowSingleChar = config.allow_single_char ?? false;

  if (password.length < minLength) {
    return { valid: false, error: `Password must be at least ${minLength} character(s)` };
  }

  if (!allowSingleChar && password.length === 1) {
    return { valid: false, error: 'Single character passwords are not allowed' };
  }

  if (!allowNumericOnly && /^\d+$/.test(password)) {
    return { valid: false, error: 'Numeric-only passwords are not allowed' };
  }

  // Always reject known weak passwords
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: 'This password is too common and easily guessed. Please choose a stronger password' };
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

  // Warn about medium-strength passwords (valid but could be stronger)
  let warning: string | undefined;
  if (password.length < 12) {
    warning = 'Consider using 12+ characters for stronger protection';
  } else if (/^[a-z]+$/.test(password) || /^[A-Z]+$/.test(password)) {
    warning = 'Consider mixing character types (letters, numbers, symbols) for stronger protection';
  }

  return { valid: true, warning };
}

/**
 * Hashes a per-variable password using Argon2id for storage.
 * The returned string is the standard Argon2 encoded hash (includes salt, params).
 */
export async function hashVariablePassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: ARGON2_OPTS.type,
    memoryCost: ARGON2_OPTS.memoryCost,
    timeCost: ARGON2_OPTS.timeCost,
    parallelism: ARGON2_OPTS.parallelism,
  });
}

/**
 * Verifies a per-variable password against a stored Argon2id hash.
 */
export async function verifyVariablePassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

/**
 * Encrypts a variable value with a per-variable password.
 * Uses the same v2 AES-256-GCM + Argon2id scheme as vault encryption.
 */
export async function encryptVariableValue(value: string, variablePassword: string): Promise<string> {
  return encrypt(value, variablePassword);
}

/**
 * Decrypts a variable value with a per-variable password.
 */
export async function decryptVariableValue(encryptedValue: string, variablePassword: string): Promise<string> {
  return decrypt(encryptedValue, variablePassword);
}

// Built-in patterns for common secret formats (applied even without explicit redact_patterns config)
const BUILTIN_SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,                                        // OpenAI API keys
  /ghp_[a-zA-Z0-9]{36}/g,                                        // GitHub personal access tokens
  /ghs_[a-zA-Z0-9]{36}/g,                                        // GitHub server tokens
  /eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,        // JWTs
  /xox[baprs]-[0-9a-zA-Z-]+/g,                                   // Slack tokens
  /AKIA[0-9A-Z]{16}/g,                                            // AWS access key IDs
];

/**
 * Scrubs known secret values and common secret patterns from command output.
 * Applied to stdout/stderr before returning envcp_run results to AI agents.
 *
 * @param output - Raw command output string
 * @param secrets - Plaintext values of injected variables (replaced with [REDACTED])
 * @param extraPatterns - Additional regex pattern strings from config
 */
export function scrubOutput(output: string, secrets: string[], extraPatterns: string[] = []): string {
  let result = output;

  // Redact known variable values (longest first to avoid partial matches)
  const sorted = [...secrets].sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    if (secret.length < 4) continue; // too short — would redact noise
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- input is fully escaped above
    result = result.replace(new RegExp(escaped, 'g'), '[REDACTED]');
  }

  // Apply built-in patterns
  for (const pattern of BUILTIN_SECRET_PATTERNS) {
    pattern.lastIndex = 0; // reset global regex state
    result = result.replace(pattern, '[REDACTED]');
  }

  // Apply caller-supplied patterns from config
  for (const patternStr of extraPatterns) {
    try {
      // eslint-disable-next-line security/detect-non-literal-regexp -- user-supplied config pattern; wrapped in try/catch to handle invalid regex
      result = result.replace(new RegExp(patternStr, 'g'), '[REDACTED]');
    } catch {
      // Ignore invalid regex patterns from config
    }
  }

  return result;
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
