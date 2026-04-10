import * as crypto from 'crypto';
import * as http from 'http';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

/**
 * Set security headers to protect against common web vulnerabilities
 */
export function setSecurityHeaders(res: http.ServerResponse): void {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Legacy XSS protection for older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Restrict resource loading to same origin
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // Prevent caching of sensitive data
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  // Remove server identification
  res.removeHeader('X-Powered-By');
}

export function setCorsHeaders(res: http.ServerResponse, allowedOrigin?: string, requestOrigin?: string): void {
  // Apply security headers first
  setSecurityHeaders(res);
  
  const localOrigins = ['http://127.0.0.1', 'http://localhost', 'http://[::1]'];
  let origin = allowedOrigin || '*';
  if (!allowedOrigin && requestOrigin) {
    const matches = localOrigins.some(lo => requestOrigin.startsWith(lo));
    origin = matches ? requestOrigin : '';
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Goog-Api-Key, OpenAI-Organization');
}

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const safeData = status >= 400 ? sanitizeError(data) : data;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(safeData));
}

function sanitizeError(data: unknown): unknown {
  if (data instanceof Error) {
    return { error: data.message };
  }
  if (typeof data === 'object' && data !== null) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value instanceof Error) {
        sanitized[key] = value.message;
      } else if (key === 'stack' || key === 'trace') {
        continue;
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
  return data;
}

export function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function validateApiKey(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(maxRequests: number = 60, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    // Periodically clean up stale entries
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs * 2);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    const recent = timestamps.filter(t => now - t < this.windowMs);

    if (recent.length >= this.maxRequests) {
      this.requests.set(key, recent);
      return false;
    }

    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }

  getRemainingRequests(key: string): number {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    const recent = timestamps.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxRequests - recent.length);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.requests) {
      const recent = timestamps.filter(t => now - t < this.windowMs);
      if (recent.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recent);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

export function rateLimitMiddleware(
  limiter: RateLimiter,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  whitelist: string[] = []
): boolean {
  const key = req.socket.remoteAddress || 'unknown';
  if (whitelist.length > 0 && whitelist.includes(key)) {
    return true;
  }
  if (!limiter.isAllowed(key)) {
    res.setHeader('Retry-After', '60');
    sendJson(res, 429, { error: 'Too many requests' });
    return false;
  }
  res.setHeader('X-RateLimit-Remaining', String(limiter.getRemainingRequests(key)));
  return true;
}
