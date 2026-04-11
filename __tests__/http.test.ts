import { validateApiKey, RateLimiter, rateLimitMiddleware } from '../src/utils/http';
import * as http from 'http';

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

describe('rateLimitMiddleware', () => {
  it('strips ::ffff: prefix from IP', () => {
    const limiter = new RateLimiter(5, 60000);
    const req = { socket: { remoteAddress: '::ffff:192.168.1.1' } } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    const result = rateLimitMiddleware(limiter, req, res);
    expect(result).toBe(true);
  });

  it('allows whitelisted IPs', () => {
    const limiter = new RateLimiter(0, 60000);
    const req = { socket: { remoteAddress: '10.0.0.1' } } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    const result = rateLimitMiddleware(limiter, req, res, ['10.0.0.1']);
    expect(result).toBe(true);
  });
});
