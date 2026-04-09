import { encrypt, decrypt, maskValue, validatePassword, quickHash, generateId, generateSessionToken } from '../src/utils/crypto';

describe('encrypt/decrypt', () => {
  it('round-trips correctly', () => {
    const text = 'hello world secret';
    const password = 'test-password-123';
    const encrypted = encrypt(text, password);
    expect(encrypted).not.toBe(text);
    expect(decrypt(encrypted, password)).toBe(text);
  });

  it('fails with wrong password', () => {
    const encrypted = encrypt('secret', 'correct');
    expect(() => decrypt(encrypted, 'wrong')).toThrow();
  });

  it('produces different ciphertext each time (random salt/iv)', () => {
    const text = 'same text';
    const password = 'same password';
    const a = encrypt(text, password);
    const b = encrypt(text, password);
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
  it('encrypt output starts with v1: prefix', () => {
    expect(encrypt('data', 'pass')).toMatch(/^v1:/);
  });

  it('decrypt handles legacy data without version prefix', () => {
    // Simulate legacy: strip v1: prefix before storing
    const modern = encrypt('legacy-secret', 'pass');
    const legacy = modern.slice('v1:'.length);
    expect(decrypt(legacy, 'pass')).toBe('legacy-secret');
  });

  it('decrypt handles modern v1: prefixed data', () => {
    const encrypted = encrypt('modern-secret', 'pass');
    expect(decrypt(encrypted, 'pass')).toBe('modern-secret');
  });
});
