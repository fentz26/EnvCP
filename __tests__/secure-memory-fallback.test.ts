import { jest } from '@jest/globals';

// Mock sodium-native with no methods available — forces HAS_SODIUM = false
jest.unstable_mockModule('sodium-native', () => ({
  __esModule: true,
  default: {},
}));

const mockExecSync = jest.fn();
jest.unstable_mockModule('child_process', () => ({
  __esModule: true,
  execSync: mockExecSync,
  default: { execSync: mockExecSync },
}));

const {
  secureAlloc,
  secureZero,
  lockMemory,
  unlockMemory,
  secureCompare,
  preventCoreDumps,
} = await import('../src/utils/secure-memory.js');

describe('secure-memory without sodium-native', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('secureAlloc falls back to Buffer.alloc with _secure=false', () => {
    const buf = secureAlloc(16) as Buffer & { _secure?: boolean };
    expect(buf.length).toBe(16);
    expect(buf._secure).toBe(false);
    expect(buf.toString('hex')).toBe('00'.repeat(16));
  });

  it('secureZero falls back to buf.fill(0)', () => {
    const buf = Buffer.from('secret-data', 'utf8');
    secureZero(buf);
    expect(buf.toString('hex')).toBe('00'.repeat(buf.length));
  });

  it('lockMemory returns false when sodium unavailable', () => {
    const buf = Buffer.alloc(8);
    expect(lockMemory(buf)).toBe(false);
  });

  it('unlockMemory is a no-op without sodium', () => {
    const buf = Buffer.alloc(8);
    expect(() => unlockMemory(buf)).not.toThrow();
  });

  it('secureCompare still works on equal buffers via timingSafeEqual', () => {
    const a = Buffer.from('equal', 'utf8');
    const b = Buffer.from('equal', 'utf8');
    expect(secureCompare(a, b)).toBe(true);
  });

  it('secureCompare returns false for unequal lengths', () => {
    expect(secureCompare(Buffer.from('a'), Buffer.from('ab'))).toBe(false);
  });

  describe('preventCoreDumps', () => {
    const origPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: origPlatform,
        configurable: true,
      });
    });

    it('returns false on unsupported platforms (e.g. win32)', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(preventCoreDumps()).toBe(false);
    });

    it('returns true when prlimit succeeds on linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      mockExecSync.mockImplementationOnce(() => Buffer.from(''));
      expect(preventCoreDumps()).toBe(true);
      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });

    it('falls back to ulimit when prlimit throws', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      mockExecSync
        .mockImplementationOnce(() => {
          throw new Error('no prlimit');
        })
        .mockImplementationOnce(() => Buffer.from(''));
      expect(preventCoreDumps()).toBe(true);
      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('returns false when both prlimit and ulimit throw', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockExecSync.mockImplementation(() => {
        throw new Error('nope');
      });
      expect(preventCoreDumps()).toBe(false);
    });
  });
});
