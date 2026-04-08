import * as crypto from 'crypto';
import * as http from 'http';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export function setCorsHeaders(res: http.ServerResponse, allowedOrigin?: string, requestOrigin?: string): void {
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
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
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
