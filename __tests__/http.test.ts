import { validateApiKey, RateLimiter, rateLimitMiddleware, setSecurityHeaders } from '../src/utils/http';
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

describe('RateLimiter default constructor — line 102', () => {
  it('uses default maxRequests=60 and windowMs=60000', () => {
    const limiter = new RateLimiter();
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.getRemainingRequests('ip1')).toBe(59);
    limiter.destroy();
  });
});

describe('setSecurityHeaders', () => {
  it('sets all required security headers', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setSecurityHeaders(res);

    expect(res.getHeader('X-Content-Type-Options')).toBe('nosniff');
    expect(res.getHeader('X-Frame-Options')).toBe('DENY');
    expect(res.getHeader('Cache-Control')).toBe('no-store, no-cache, must-revalidate, private');
    expect(res.getHeader('Referrer-Policy')).toBe('no-referrer');
    expect(res.getHeader('Content-Security-Policy')).toContain("default-src 'none'");
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

  it('uses unknown when remoteAddress is undefined — line 155', () => {
    const limiter = new RateLimiter(1, 60000);
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    // First request should be allowed ('unknown' key)
    const r1 = rateLimitMiddleware(limiter, req, res);
    expect(r1).toBe(true);
    // Second should be blocked (same 'unknown' key, limit=1)
    const r2 = rateLimitMiddleware(limiter, req, res);
    expect(r2).toBe(false);
    limiter.destroy();
  });
});
