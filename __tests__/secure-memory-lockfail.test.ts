import { jest } from '@jest/globals';

const mockMalloc = jest.fn((n: number) => Buffer.alloc(n));
const mockMemzero = jest.fn((buf: Buffer) => buf.fill(0));
const mockMlock = jest.fn(() => {
  throw new Error('mlock not permitted');
});
const mockMunlock = jest.fn(() => {
  throw new Error('munlock not permitted');
});

jest.unstable_mockModule('sodium-native', () => ({
  __esModule: true,
  default: {
    sodium_malloc: mockMalloc,
    sodium_memzero: mockMemzero,
    sodium_mlock: mockMlock,
    sodium_munlock: mockMunlock,
  },
  sodium_malloc: mockMalloc,
  sodium_memzero: mockMemzero,
  sodium_mlock: mockMlock,
  sodium_munlock: mockMunlock,
}));

const { lockMemory, unlockMemory, secureAlloc, secureZero } = await import(
  '../src/utils/secure-memory.js'
);

describe('secure-memory with sodium present but mlock failing', () => {
  it('lockMemory returns false when sodium_mlock throws', () => {
    const buf = secureAlloc(8);
    expect(lockMemory(buf)).toBe(false);
  });

  it('unlockMemory swallows sodium_munlock errors', () => {
    const buf = secureAlloc(8);
    expect(() => unlockMemory(buf)).not.toThrow();
  });

  it('secureZero routes through sodium_memzero when available', () => {
    const buf = Buffer.from('seekrit', 'utf8');
    secureZero(buf);
    expect(mockMemzero).toHaveBeenCalled();
  });
});
