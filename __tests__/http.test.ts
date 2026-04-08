import { validateApiKey, RateLimiter } from '../src/utils/http';

describe('validateApiKey', () => {
  it('returns false for undefined', () => {
    expect(validateApiKey(undefined, 'expected')).toBe(false);
  });

  it('returns false for wrong length', () => {
    expect(validateApiKey('short', 'expected-key')).toBe(false);
  });

  it('returns false for wrong key', () => {
    expect(validateApiKey('wrong-key-xx', 'expected-key')).toBe(false);
  });

  it('returns true for correct key', () => {
    expect(validateApiKey('my-secret-key', 'my-secret-key')).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new RateLimiter(3, 60000);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(true);
  });

  it('blocks requests over limit', () => {
    const limiter = new RateLimiter(2, 60000);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(false);
  });

  it('tracks IPs independently', () => {
    const limiter = new RateLimiter(1, 60000);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip2')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(false);
  });

  it('reports remaining requests', () => {
    const limiter = new RateLimiter(3, 60000);
    expect(limiter.getRemainingRequests('ip1')).toBe(3);
    limiter.isAllowed('ip1');
    expect(limiter.getRemainingRequests('ip1')).toBe(2);
  });
});
