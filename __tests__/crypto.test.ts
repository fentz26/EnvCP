import { encrypt, decrypt, maskValue, validatePassword, quickHash, generateId, generateSessionToken } from '../src/utils/crypto';

describe('encrypt/decrypt', () => {
  it('round-trips correctly', async () => {
    const text = 'hello world secret';
    const password = 'test-password-123';
    const encrypted = await encrypt(text, password);
    expect(encrypted).not.toBe(text);
    expect(await decrypt(encrypted, password)).toBe(text);
  });

  it('fails with wrong password', async () => {
    const encrypted = await encrypt('secret', 'correct');
    await expect(decrypt(encrypted, 'wrong')).rejects.toThrow();
  });

  it('produces different ciphertext each time (random salt/iv)', async () => {
    const text = 'same text';
    const password = 'same password';
    const a = await encrypt(text, password);
    const b = await encrypt(text, password);
    expect(a).not.toBe(b);
  });
});

describe('maskValue', () => {
  it('fully masks short values', () => {
    expect(maskValue('ab')).toBe('**');
    expect(maskValue('abcdefgh')).toBe('********');
  });

  it('shows prefix/suffix for longer values', () => {
    const result = maskValue('abcdefghijklmnop');
    expect(result.startsWith('abcd')).toBe(true);
    expect(result.endsWith('mnop')).toBe(true);
    expect(result).toContain('*');
  });
});

describe('validatePassword', () => {
  it('accepts valid password with defaults', () => {
    expect(validatePassword('a', {}).valid).toBe(true);
  });

  it('rejects too short password', () => {
    expect(validatePassword('', { min_length: 1 }).valid).toBe(false);
  });

  it('rejects single char when disallowed', () => {
    expect(validatePassword('a', { allow_single_char: false }).valid).toBe(false);
  });

  it('rejects numeric-only when disallowed', () => {
    expect(validatePassword('1234', { allow_numeric_only: false }).valid).toBe(false);
  });

  it('enforces complexity', () => {
    expect(validatePassword('abc', { require_complexity: true }).valid).toBe(false);
    expect(validatePassword('Abc123!', { require_complexity: true }).valid).toBe(true);
  });
});

describe('helpers', () => {
  it('generateId returns 32-char hex', () => {
    expect(generateId()).toMatch(/^[a-f0-9]{32}$/);
  });

  it('generateSessionToken returns 64-char hex', () => {
    expect(generateSessionToken()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('quickHash returns 16-char hex', () => {
    expect(quickHash('test')).toMatch(/^[a-f0-9]{16}$/);
    expect(quickHash('test')).toBe(quickHash('test'));
  });
});

describe('encryption versioning', () => {
  it('encrypt output starts with v2: prefix (Argon2id)', async () => {
    expect(await encrypt('data', 'pass')).toMatch(/^v2:/);
  });

  it('decrypt handles legacy v1: (PBKDF2) data', async () => {
    // Simulate existing v1: data by using the raw PBKDF2 path directly
    // We construct a valid v1: ciphertext using the same format as the old code
    const crypto = await import('crypto');
    const SALT_LENGTH = 64;
    const IV_LENGTH = 16;
    const password = 'legacy-pass';
    const plaintext = 'legacy-secret';

    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(plaintext, 'utf8', 'hex');
    enc += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    const v1Data = 'v1:' + salt.toString('hex') + iv.toString('hex') + authTag.toString('hex') + enc;
    expect(await decrypt(v1Data, password)).toBe(plaintext);
  });

  it('decrypt handles modern v2: prefixed data', async () => {
    const encrypted = await encrypt('modern-secret', 'pass');
    expect(await decrypt(encrypted, 'pass')).toBe('modern-secret');
  });
});
