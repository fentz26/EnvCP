import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  secureAlloc,
  secureFree,
  secureZero,
  lockMemory,
  unlockMemory,
  passwordToBuffer,
  secureCompare,
  isDebuggerAttached,
  preventCoreDumps,
  initMemoryProtection,
} from '../src/utils/secure-memory.js';

describe('secure-memory', () => {
  describe('secureAlloc and secureFree', () => {
    it('allocates a buffer of the requested size', () => {
      const buf = secureAlloc(32);
      expect(buf.length).toBe(32);
    });

    it('allocated buffer can be written to', () => {
      const buf = secureAlloc(16);
      buf.write('test', 'utf8');
      expect(buf.toString('utf8').startsWith('test')).toBe(true);
    });
  });

  describe('secureZero', () => {
    it('zeros a buffer with data', () => {
      const buf = Buffer.from('sensitive data here', 'utf8');
      expect(buf.toString('utf8')).toBe('sensitive data here');
      secureZero(buf);
      expect(buf.toString('hex')).toBe('00'.repeat(buf.length));
    });

    it('handles empty buffer without error', () => {
      const buf = Buffer.alloc(0);
      expect(() => secureZero(buf)).not.toThrow();
    });

    it('handles null/undefined gracefully', () => {
      expect(() => secureZero(null as unknown as Buffer)).not.toThrow();
      expect(() => secureZero(undefined as unknown as Buffer)).not.toThrow();
    });
  });

  describe('lockMemory and unlockMemory', () => {
    it('returns boolean for lockMemory', () => {
      const buf = secureAlloc(32);
      const result = lockMemory(buf);
      expect(typeof result).toBe('boolean');
      unlockMemory(buf);
    });
  });

  describe('passwordToBuffer', () => {
    it('converts string to buffer', () => {
      const password = 'mySecretPassword123!';
      const buf = passwordToBuffer(password);
      expect(buf.length).toBe(Buffer.byteLength(password, 'utf8'));
      expect(buf.toString('utf8')).toBe(password);
    });

    it('handles unicode passwords', () => {
      const password = '密码🔐';
      const buf = passwordToBuffer(password);
      expect(buf.toString('utf8')).toBe(password);
    });
  });

  describe('secureCompare', () => {
    it('returns true for equal buffers', () => {
      const a = Buffer.from('password123', 'utf8');
      const b = Buffer.from('password123', 'utf8');
      expect(secureCompare(a, b)).toBe(true);
    });

    it('returns false for different buffers', () => {
      const a = Buffer.from('password123', 'utf8');
      const b = Buffer.from('password456', 'utf8');
      expect(secureCompare(a, b)).toBe(false);
    });

    it('returns false for different length buffers', () => {
      const a = Buffer.from('short', 'utf8');
      const b = Buffer.from('longerpassword', 'utf8');
      expect(secureCompare(a, b)).toBe(false);
    });
  });

  describe('isDebuggerAttached', () => {
    it('returns boolean', () => {
      const result = isDebuggerAttached();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('preventCoreDumps', () => {
    it('returns boolean', () => {
      const result = preventCoreDumps();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('initMemoryProtection', () => {
    it('returns status object', () => {
      const result = initMemoryProtection();
      expect(result).toHaveProperty('coreDumpsDisabled');
      expect(result).toHaveProperty('debuggerDetected');
      expect(typeof result.coreDumpsDisabled).toBe('boolean');
      expect(typeof result.debuggerDetected).toBe('boolean');
    });

    it('is idempotent', () => {
      const result1 = initMemoryProtection();
      const result2 = initMemoryProtection();
      expect(result1).toEqual(result2);
    });
  });
});

describe('crypto integration with secureZero', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-crypto-secure-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('encrypt and decrypt with buffer zeroing', async () => {
    const { encrypt, decrypt } = await import('../src/utils/crypto.js');
    const password = 'testPassword123!';
    const plaintext = 'secret message';

    const encrypted = await encrypt(plaintext, password);
    expect(encrypted).toContain('v2:');

    const decrypted = await decrypt(encrypted, password);
    expect(decrypted).toBe(plaintext);
  });

  it('decrypt handles corrupted data gracefully', async () => {
    const { decrypt } = await import('../src/utils/crypto.js');
    const password = 'testPassword123!';
    const corrupted = 'v2:abcdef1234567890';

    await expect(decrypt(corrupted, password)).rejects.toThrow();
  });
});
