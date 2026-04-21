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

  it('accepts Buffer passwords without converting them first', async () => {
    const password = Buffer.from('buffer-password-123');
    const encrypted = await encrypt('hello', password);
    expect(await decrypt(encrypted, password)).toBe('hello');
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
  it('accepts valid password with defaults (8+ chars)', () => {
    expect(validatePassword('mypasswd', {}).valid).toBe(true);
  });

  it('rejects too short password with default min_length=8', () => {
    expect(validatePassword('short', {}).valid).toBe(false);
  });

  it('rejects too short password with custom min_length', () => {
    expect(validatePassword('', { min_length: 1 }).valid).toBe(false);
  });

  it('accepts short password when min_length is lowered', () => {
    expect(validatePassword('abc', { min_length: 1, allow_single_char: true }).valid).toBe(true);
  });

  it('rejects single char when disallowed (default)', () => {
    expect(validatePassword('a', { min_length: 1 }).valid).toBe(false);
  });

  it('rejects numeric-only when disallowed (default)', () => {
    expect(validatePassword('12345678', {}).valid).toBe(false);
  });

  it('accepts numeric-only when explicitly allowed (non-common number)', () => {
    expect(validatePassword('98237461', { allow_numeric_only: true }).valid).toBe(true);
  });

  it('rejects known weak passwords', () => {
    expect(validatePassword('password', { min_length: 1 }).valid).toBe(false);
    expect(validatePassword('password123', {}).valid).toBe(false);
    expect(validatePassword('12345678', { allow_numeric_only: true }).valid).toBe(false);
    expect(validatePassword('qwerty123', {}).valid).toBe(false);
    expect(validatePassword('trustno1', { min_length: 1 }).valid).toBe(false);
  });

  it('rejects weak passwords case-insensitively', () => {
    expect(validatePassword('PASSWORD', { min_length: 1 }).valid).toBe(false);
    expect(validatePassword('Password123', {}).valid).toBe(false);
  });

  it('enforces complexity', () => {
    expect(validatePassword('abcdefgh', { require_complexity: true }).valid).toBe(false);
    expect(validatePassword('Abc123!x', { require_complexity: true }).valid).toBe(true);
  });

  it('rejects non-weak password with only 2 char types when complexity required', () => {
    const result = validatePassword('Randomwordsonly', { require_complexity: true, min_length: 1 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('3 of');
  });

  it('returns warning for short-but-valid passwords', () => {
    const result = validatePassword('MyP@ss99', {});
    expect(result.valid).toBe(true);
    expect(result.warning).toContain('12+');
  });

  it('returns warning for single-case-only long passwords', () => {
    const result = validatePassword('abcdefghijklmn', {});
    expect(result.valid).toBe(true);
    expect(result.warning).toContain('mixing');
  });

  it('no warning for strong passwords', () => {
    const result = validatePassword('MyStr0ng!P@ssphrase', {});
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
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

describe('scrubOutput', () => {
  let scrubOutput: (output: string, secrets: string[], extraPatterns?: string[]) => string;

  beforeAll(async () => {
    ({ scrubOutput } = await import('../src/utils/crypto'));
  });

  it('replaces injected secret values with [REDACTED]', () => {
    const result = scrubOutput('output: sk-abcdefgh1234', ['sk-abcdefgh1234']);
    expect(result).toBe('output: [REDACTED]');
  });

  it('skips secrets shorter than 4 chars', () => {
    const result = scrubOutput('output: abc xyz', ['abc']);
    expect(result).toBe('output: abc xyz');
  });

  it('redacts longest secrets first to avoid partial matches', () => {
    const result = scrubOutput('token: secretvalue-extra', ['secretvalue', 'secretvalue-extra']);
    expect(result).toBe('token: [REDACTED]');
  });

  it('applies built-in pattern: OpenAI API key', () => {
    const result = scrubOutput('key=sk-abcdefghijklmnopqrstu', []);
    expect(result).toBe('key=[REDACTED]');
  });

  it('applies built-in pattern: GitHub PAT', () => {
    const result = scrubOutput('pat=ghp_' + 'a'.repeat(36), []);
    expect(result).toContain('[REDACTED]');
  });

  it('applies built-in pattern: JWT token', () => {
    const result = scrubOutput('token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.abc123', []);
    expect(result).toContain('[REDACTED]');
  });

  it('applies extra patterns from config', () => {
    const result = scrubOutput('mytoken: tok_abc123', [], ['tok_[a-z0-9]+']);
    expect(result).toBe('mytoken: [REDACTED]');
  });

  it('ignores invalid regex patterns gracefully without throwing', () => {
    const result = scrubOutput('output text here', [], ['[invalid(regex']);
    expect(result).toBe('output text here');
  });

  it('returns output unchanged when no secrets or patterns', () => {
    const result = scrubOutput('hello world', []);
    expect(result).toBe('hello world');
  });
});
