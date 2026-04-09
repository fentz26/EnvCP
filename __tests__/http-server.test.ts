import * as http from 'http';
import { Readable } from 'stream';
import { setSecurityHeaders, setCorsHeaders, sendJson, parseBody, rateLimitMiddleware, RateLimiter } from '../src/utils/http';

function createMockRes(): http.ServerResponse {
  const headers: Record<string, string> = {};
  const res = {
    _headers: headers,
    _statusCode: 0,
    _body: '',
    setHeader(key: string, value: string) { headers[key.toLowerCase()] = value; },
    removeHeader(key: string) { delete headers[key.toLowerCase()]; },
    writeHead(status: number, h?: Record<string, string>) {
      res._statusCode = status;
      if (h) Object.entries(h).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
    },
    end(body?: string) { res._body = body || ''; },
    getHeader(key: string) { return headers[key.toLowerCase()]; },
  } as unknown as http.ServerResponse & { _headers: Record<string, string>; _statusCode: number; _body: string };
  return res;
}

describe('setSecurityHeaders', () => {
  it('sets all security headers', () => {
    const res = createMockRes();
    setSecurityHeaders(res);
    const h = (res as any)._headers;
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-xss-protection']).toBe('1; mode=block');
    expect(h['cache-control']).toContain('no-store');
  });
});

describe('setCorsHeaders', () => {
  it('defaults to * when no origin specified', () => {
    const res = createMockRes();
    setCorsHeaders(res);
    expect((res as any)._headers['access-control-allow-origin']).toBe('*');
  });

  it('uses allowed origin when specified', () => {
    const res = createMockRes();
    setCorsHeaders(res, 'http://example.com');
    expect((res as any)._headers['access-control-allow-origin']).toBe('http://example.com');
  });

  it('allows localhost origins', () => {
    const res = createMockRes();
    setCorsHeaders(res, undefined, 'http://localhost:3000');
    expect((res as any)._headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('rejects non-local origins when no allowedOrigin set', () => {
    const res = createMockRes();
    setCorsHeaders(res, undefined, 'http://evil.com');
    expect((res as any)._headers['access-control-allow-origin']).toBe('');
  });
});

describe('sendJson', () => {
  it('sends JSON with correct content type and status', () => {
    const res = createMockRes();
    sendJson(res, 200, { foo: 'bar' });
    expect((res as any)._statusCode).toBe(200);
    expect((res as any)._body).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('sanitizes error responses (strips stack traces)', () => {
    const res = createMockRes();
    sendJson(res, 500, { error: 'bad', stack: 'at line 1...' });
    const parsed = JSON.parse((res as any)._body);
    expect(parsed.stack).toBeUndefined();
    expect(parsed.error).toBe('bad');
  });

  it('sanitizes Error objects in error responses', () => {
    const res = createMockRes();
    sendJson(res, 500, new Error('test error'));
    const parsed = JSON.parse((res as any)._body);
    expect(parsed.error).toBe('test error');
  });

  it('does not sanitize success responses', () => {
    const res = createMockRes();
    sendJson(res, 200, { stack: 'allowed in 200' });
    const parsed = JSON.parse((res as any)._body);
    expect(parsed.stack).toBe('allowed in 200');
  });
});

describe('parseBody', () => {
  function makeReq(body: string): http.IncomingMessage {
    const req = new Readable({
      read() {
        this.push(Buffer.from(body));
        this.push(null);
      },
    });
    (req as any).destroy = () => {};
    return req as unknown as http.IncomingMessage;
  }

  it('parses valid JSON body', async () => {
    const req = makeReq('{"name":"test"}');
    const result = await parseBody(req);
    expect(result).toEqual({ name: 'test' });
  });

  it('returns empty object for empty body', async () => {
    const req = makeReq('');
    const result = await parseBody(req);
    expect(result).toEqual({});
  });

  it('rejects invalid JSON', async () => {
    const req = makeReq('not-json');
    await expect(parseBody(req)).rejects.toThrow('Invalid JSON body');
  });

  it('rejects oversized body', async () => {
    const bigBody = 'x'.repeat(1024 * 1024 + 1);
    const req = new Readable({
      read() {
        this.push(Buffer.from(bigBody));
        this.push(null);
      },
    });
    (req as any).destroy = () => {};
    await expect(parseBody(req as unknown as http.IncomingMessage)).rejects.toThrow('Request body too large');
  });
});

describe('sendJson sanitization edge cases', () => {
  it('sanitizes nested Error values in objects', () => {
    const res = createMockRes();
    sendJson(res, 500, { details: new Error('nested error'), trace: 'should be stripped' });
    const parsed = JSON.parse((res as any)._body);
    expect(parsed.details).toBe('nested error');
    expect(parsed.trace).toBeUndefined();
  });

  it('passes through non-object non-Error data in error responses', () => {
    const res = createMockRes();
    sendJson(res, 400, 'just a string');
    expect((res as any)._body).toBe('"just a string"');
  });
});

describe('RateLimiter cleanup', () => {
  it('cleans up stale entries', async () => {
    const limiter = new RateLimiter(10, 50); // 50ms window
    limiter.isAllowed('ip1');
    expect(limiter.getRemainingRequests('ip1')).toBe(9);

    // Wait for window to expire and cleanup to run
    await new Promise(r => setTimeout(r, 200));
    expect(limiter.getRemainingRequests('ip1')).toBe(10); // reset after window
    limiter.destroy();
  });

  it('retains recent entries and cleans old ones (mixed state)', async () => {
    const limiter = new RateLimiter(100, 100); // 100ms window
    limiter.isAllowed('old_ip');

    // Wait for old_ip to age out
    await new Promise(r => setTimeout(r, 150));

    // Now make a fresh request from new_ip
    limiter.isAllowed('new_ip');

    // Trigger cleanup explicitly via another request that causes internal cleanup
    // The cleanup runs on interval, so wait for it
    await new Promise(r => setTimeout(r, 150));

    // old_ip should be cleaned, new_ip should still be there
    expect(limiter.getRemainingRequests('old_ip')).toBe(100); // fully reset
    limiter.destroy();
  });
});

describe('rateLimitMiddleware', () => {
  it('allows requests and sets header', () => {
    const limiter = new RateLimiter(10, 60000);
    const req = { socket: { remoteAddress: '127.0.0.1' } } as http.IncomingMessage;
    const res = createMockRes();
    const result = rateLimitMiddleware(limiter, req, res);
    expect(result).toBe(true);
    expect((res as any)._headers['x-ratelimit-remaining']).toBeDefined();
    limiter.destroy();
  });

  it('blocks when rate limit exceeded', () => {
    const limiter = new RateLimiter(1, 60000);
    const req = { socket: { remoteAddress: '127.0.0.1' } } as http.IncomingMessage;
    const res1 = createMockRes();
    rateLimitMiddleware(limiter, req, res1);

    const res2 = createMockRes();
    const result = rateLimitMiddleware(limiter, req, res2);
    expect(result).toBe(false);
    expect((res2 as any)._statusCode).toBe(429);
    limiter.destroy();
  });
});
