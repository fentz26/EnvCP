import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { UnifiedServer } from '../src/server/unified';
import { EnvCPConfigSchema, ServerConfig } from '../src/types';

const makeConfig = () => EnvCPConfigSchema.parse({
  access: {
    allow_ai_read: true,
    allow_ai_write: true,
    allow_ai_delete: true,
    allow_ai_export: true,
    allow_ai_execute: true,
    allow_ai_active_check: true,
    require_user_reference: false,
    require_confirmation: false,
    mask_values: false,
    blacklist_patterns: [],
  },
  encryption: { enabled: false },
  storage: { encrypted: false, path: '.envcp/store.json' },
  sync: { enabled: false },
});

function fetch(port: number, method: string, urlPath: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('UnifiedServer', () => {
  let tmpDir: string;
  let server: UnifiedServer;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-unified-'));
    port = 30000 + Math.floor(Math.random() * 10000);
    const serverConfig: ServerConfig = {
      mode: 'auto',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
    };
    server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();
  });

  afterAll(() => {
    server.stop();
  });

  it('GET / returns server info with auto mode', async () => {
    const { status, data } = await fetch(port, 'GET', '/');
    expect(status).toBe(200);
    expect((data as any).name).toBe('EnvCP Unified Server');
    expect((data as any).mode).toBe('auto');
  });

  it('handles CORS preflight', async () => {
    const { status } = await fetch(port, 'OPTIONS', '/');
    expect(status).toBe(204);
  });

  it('routes REST requests to /api/*', async () => {
    const { status, data } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('routes OpenAI requests to /v1/models', async () => {
    const { status, data } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
  });

  it('routes Gemini requests to generateContent', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/models/envcp:generateContent', {
      contents: [{ parts: [{ text: 'hello' }] }],
    });
    expect(status).toBe(200);
  });

  it('returns 404 for unknown paths', async () => {
    const { status } = await fetch(port, 'GET', '/unknown');
    expect(status).toBe(404);
  });

  it('supports ?mode=rest query param', async () => {
    const { status, data } = await fetch(port, 'GET', '/api/health?mode=rest');
    expect(status).toBe(200);
  });

  describe('API key validation', () => {
    let authServer: UnifiedServer;
    let authPort: number;

    beforeAll(async () => {
      authPort = 30000 + Math.floor(Math.random() * 10000);
      const serverConfig: ServerConfig = {
        mode: 'auto',
        port: authPort,
        host: '127.0.0.1',
        cors: true,
        auto_detect: true,
        api_key: 'test-secret-key',
      };
      authServer = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
      await authServer.start();
    });

    afterAll(() => {
      authServer.stop();
    });

    it('rejects requests without API key', async () => {
      const { status } = await fetch(authPort, 'GET', '/api/health');
      expect(status).toBe(401);
    });

    it('accepts requests with valid X-API-Key', async () => {
      const { status } = await fetch(authPort, 'GET', '/api/health', undefined, { 'X-API-Key': 'test-secret-key' });
      expect(status).toBe(200);
    });

    it('accepts requests with valid Bearer token', async () => {
      const { status } = await fetch(authPort, 'GET', '/api/health', undefined, { 'Authorization': 'Bearer test-secret-key' });
      expect(status).toBe(200);
    });
  });

  describe('CRUD via unified server', () => {
    it('creates, reads, updates, deletes via REST routes', async () => {
      // Create
      const c = await fetch(port, 'POST', '/api/variables', { name: 'UNI_VAR', value: 'initial' });
      expect(c.status).toBe(201);

      // Read
      const r = await fetch(port, 'GET', '/api/variables/UNI_VAR');
      expect(r.status).toBe(200);
      expect((r.data as any).data.name).toBe('UNI_VAR');

      // Update
      const u = await fetch(port, 'PUT', '/api/variables/UNI_VAR', { value: 'updated' });
      expect(u.status).toBe(200);

      // Delete
      const d = await fetch(port, 'DELETE', '/api/variables/UNI_VAR');
      expect(d.status).toBe(200);
    });
  });
});

describe('UnifiedServer.detectClientType', () => {
  const config = makeConfig();
  const serverConfig: ServerConfig = { mode: 'auto', port: 0, host: '127.0.0.1', cors: true, auto_detect: true };
  const server = new UnifiedServer(config, serverConfig, '/tmp');

  function makeReq(url: string, headers: Record<string, string> = {}): http.IncomingMessage {
    return { url, headers: { host: 'localhost', ...headers } } as http.IncomingMessage;
  }

  it('detects OpenAI from path', () => {
    expect(server.detectClientType(makeReq('/v1/chat/completions'))).toBe('openai');
  });

  it('detects OpenAI from header', () => {
    expect(server.detectClientType(makeReq('/v1/x', { 'openai-organization': 'org' }))).toBe('openai');
  });

  it('detects Gemini from path', () => {
    expect(server.detectClientType(makeReq('/v1/models/envcp:generateContent'))).toBe('gemini');
  });

  it('detects Gemini from header', () => {
    expect(server.detectClientType(makeReq('/v1/x', { 'x-goog-api-key': 'key' }))).toBe('gemini');
  });

  it('detects MCP from header', () => {
    expect(server.detectClientType(makeReq('/x', { 'x-mcp-version': '1.0' }))).toBe('mcp');
  });

  it('detects REST from /api path', () => {
    expect(server.detectClientType(makeReq('/api/variables'))).toBe('rest');
  });

  it('returns unknown for unrecognized requests', () => {
    expect(server.detectClientType(makeReq('/something'))).toBe('unknown');
  });
});
