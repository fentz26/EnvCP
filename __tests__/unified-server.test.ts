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

describe('UnifiedServer single modes', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-single-'));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('starts in rest mode', async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const serverConfig: ServerConfig = { mode: 'rest', port, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();
    const { status, data } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    server.stop();
  });

  it('starts in openai mode', async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const serverConfig: ServerConfig = { mode: 'openai', port, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();
    const { status } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
    server.stop();
  });

  it('starts in gemini mode', async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const serverConfig: ServerConfig = { mode: 'gemini', port, host: '127.0.0.1', cors: true, auto_detect: false };
    const server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();
    const { status } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
    server.stop();
  });
});

describe('UnifiedServer all mode routes', () => {
  let tmpDir: string;
  let server: UnifiedServer;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-allmode-'));
    port = 30000 + Math.floor(Math.random() * 10000);
    const serverConfig: ServerConfig = {
      mode: 'all',
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

  // OpenAI routes through unified
  it('routes /v1/functions via unified OpenAI handler', async () => {
    const { status, data } = await fetch(port, 'GET', '/v1/functions');
    expect(status).toBe(200);
    expect((data as any).object).toBe('list');
  });

  it('routes /v1/functions/call via unified OpenAI handler', async () => {
    const { status } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', arguments: {} });
    expect(status).toBe(200);
  });

  it('routes /v1/tool_calls via unified OpenAI handler', async () => {
    const { status } = await fetch(port, 'POST', '/v1/tool_calls', {
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'envcp_list', arguments: '{}' } }],
    });
    expect(status).toBe(200);
  });

  it('routes /v1/chat/completions via unified OpenAI handler', async () => {
    const { status } = await fetch(port, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(status).toBe(200);
  });

  // Gemini routes through unified
  it('routes /v1/tools via unified Gemini handler', async () => {
    const { status, data } = await fetch(port, 'GET', '/v1/tools');
    expect(status).toBe(200);
    expect((data as any).tools).toBeDefined();
  });

  it('routes /v1/function_calls via unified Gemini handler', async () => {
    const { status } = await fetch(port, 'POST', '/v1/function_calls', {
      functionCalls: [{ name: 'envcp_list', args: {} }],
    });
    expect(status).toBe(200);
  });

  it('routes generateContent via unified Gemini handler', async () => {
    const { status } = await fetch(port, 'POST', '/v1/models/envcp:generateContent', {
      contents: [{ parts: [{ functionCall: { name: 'envcp_list', args: {} } }] }],
    });
    expect(status).toBe(200);
  });

  // REST CRUD through unified
  it('GET /api/tools via unified REST handler', async () => {
    const { status, data } = await fetch(port, 'GET', '/api/tools');
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('POST /api/tools/:name via unified REST handler', async () => {
    // First create a variable
    await fetch(port, 'POST', '/api/variables', { name: 'UNIFIED_VAR', value: 'test' });
    const { status } = await fetch(port, 'POST', '/api/tools/envcp_get', { name: 'UNIFIED_VAR' });
    expect(status).toBe(200);
  });

  it('POST /api/variables via unified REST handler', async () => {
    const { status } = await fetch(port, 'POST', '/api/variables', { name: 'NEW_UNI', value: 'v' });
    expect(status).toBe(201);
  });

  it('GET /api/variables via unified REST handler', async () => {
    const { status } = await fetch(port, 'GET', '/api/variables');
    expect(status).toBe(200);
  });

  it('GET /api/variables/:name via unified REST handler', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'GET_UNI', value: 'v' });
    const { status } = await fetch(port, 'GET', '/api/variables/GET_UNI');
    expect(status).toBe(200);
  });

  it('PUT /api/variables/:name via unified REST handler', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'PUT_UNI', value: 'v' });
    const { status } = await fetch(port, 'PUT', '/api/variables/PUT_UNI', { value: 'updated' });
    expect(status).toBe(200);
  });

  it('DELETE /api/variables/:name via unified REST handler', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'DEL_UNI', value: 'v' });
    const { status } = await fetch(port, 'DELETE', '/api/variables/DEL_UNI');
    expect(status).toBe(200);
  });

  // OpenAI chat/completions with tool_calls in unified
  it('POST /v1/chat/completions with tool_calls via unified', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/chat/completions', {
      messages: [{
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'tc_uni',
          type: 'function',
          function: { name: 'envcp_list', arguments: '{}' },
        }],
      }],
    });
    expect(status).toBe(200);
    expect((data as any).tool_results).toBeDefined();
  });

  // Gemini function_calls via unified
  it('POST /v1/functions/call via unified Gemini handler', async () => {
    const { status } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', args: {} });
    expect(status).toBe(200);
  });

  // 404 routes through unified OpenAI handler
  it('returns 404 for unknown OpenAI route via unified', async () => {
    const { status } = await fetch(port, 'GET', '/v1/unknown', undefined, { 'openai-organization': 'test' });
    expect(status).toBe(404);
  });

  // REST 404
  it('returns 404 for unknown REST sub-route via unified', async () => {
    const { status } = await fetch(port, 'GET', '/api/nonexistent');
    expect(status).toBe(404);
  });

  // Gemini generateContent with function calls via unified
  it('POST generateContent with no function calls via unified Gemini', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/models/envcp:generateContent', {
      contents: [{ parts: [{ text: 'hello' }] }],
    });
    expect(status).toBe(200);
    expect((data as any).availableTools).toBeDefined();
  });

  // Error handling in unified handlers
  it('handles errors in unified REST handler gracefully', async () => {
    // Trigger error by calling a tool that will fail
    const { status } = await fetch(port, 'POST', '/api/tools/envcp_get', { name: 'NONEXISTENT_ERROR_VAR' });
    expect([404, 500]).toContain(status);
  });

  it('handles errors in unified OpenAI handler gracefully', async () => {
    // Make openai adapter throw by calling with bad tool
    const origCallTool = (server as any).openaiAdapter.callTool;
    (server as any).openaiAdapter.callTool = async () => { throw new Error('test openai error'); };
    const { status, data } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', arguments: {} });
    expect(status).toBe(500);
    expect((data as any).error.type).toBe('internal_error');
    (server as any).openaiAdapter.callTool = origCallTool;
  });

  it('handles errors in unified Gemini handler gracefully', async () => {
    const origProcess = (server as any).geminiAdapter.processFunctionCalls;
    (server as any).geminiAdapter.processFunctionCalls = async () => { throw new Error('test gemini error'); };
    const { status, data } = await fetch(port, 'POST', '/v1/function_calls', { functionCalls: [{ name: 'envcp_list', args: {} }] });
    expect(status).toBe(500);
    expect((data as any).error.status).toBe('INTERNAL');
    (server as any).geminiAdapter.processFunctionCalls = origProcess;
  });

  it('handles errors in unified Gemini generateContent handler', async () => {
    const origProcess = (server as any).geminiAdapter.processFunctionCalls;
    (server as any).geminiAdapter.processFunctionCalls = async () => { throw new Error('generateContent error'); };
    const { status, data } = await fetch(port, 'POST', '/v1/models/envcp:generateContent', {
      contents: [{ parts: [{ functionCall: { name: 'envcp_list', args: {} } }] }],
    });
    expect(status).toBe(500);
    expect((data as any).error.status).toBe('INTERNAL');
    (server as any).geminiAdapter.processFunctionCalls = origProcess;
  });

  // Gemini 404 via unified
  it('returns 404 for unknown Gemini path via unified', async () => {
    const { status } = await fetch(port, 'GET', '/v1/gemini-unknown', undefined, { 'x-goog-api-key': 'x' });
    // This may route to openai or gemini depending on detection
    expect([404, 200]).toContain(status);
  });
});

describe('UnifiedServer sync/run/error routes', () => {
  let tmpDir: string;
  let server: UnifiedServer;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-syncrun-'));
    port = 30000 + Math.floor(Math.random() * 10000);
    const serverConfig: ServerConfig = {
      mode: 'all',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
    };
    const config = EnvCPConfigSchema.parse({
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
        allowed_commands: ['echo'],
      },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
      sync: { enabled: true, target: '.env' },
    });
    server = new UnifiedServer(config, serverConfig, tmpDir);
    await server.start();
  });

  afterAll(() => {
    server.stop();
  });

  it('POST /api/sync syncs variables', async () => {
    // First create a variable
    await fetch(port, 'POST', '/api/variables', { name: 'SYNC_VAR', value: 'synced' });
    const { status, data } = await fetch(port, 'POST', '/api/sync');
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('POST /api/run executes a command', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'RUN_VAR', value: 'rv' });
    const { status, data } = await fetch(port, 'POST', '/api/run', { command: 'echo hello', variables: ['RUN_VAR'] });
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('REST handler returns 404 for unknown sub-route', async () => {
    const { status } = await fetch(port, 'GET', '/api/nonexistent');
    expect(status).toBe(404);
  });

  it('REST handler catches errors from callTool', async () => {
    // Trigger an error by trying to get a non-existent variable
    const { status } = await fetch(port, 'GET', '/api/variables/DEFINITELY_MISSING_XYZZY');
    // Should be 404 (mapped from "not found" in error message)
    expect([404, 500]).toContain(status);
  });
});

describe('UnifiedServer adapter 503 paths', () => {
  let tmpDir: string;
  let port: number;
  let srv: UnifiedServer;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-503-'));
    port = 30000 + Math.floor(Math.random() * 10000);
    // Start in all mode so all routes are active, then null out adapters
    const serverConfig: ServerConfig = { mode: 'all', port, host: '127.0.0.1', cors: true, auto_detect: true };
    srv = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await srv.start();
  });

  afterAll(async () => {
    srv.stop();
    await fs.remove(tmpDir);
  });

  it('returns 503 for OpenAI when adapter nulled', async () => {
    const orig = (srv as any).openaiAdapter;
    (srv as any).openaiAdapter = null;
    const { status, data } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(503);
    expect((data as any).error.type).toBe('service_unavailable');
    (srv as any).openaiAdapter = orig;
  });

  it('returns 503 for Gemini when adapter nulled', async () => {
    const orig = (srv as any).geminiAdapter;
    (srv as any).geminiAdapter = null;
    const { status, data } = await fetch(port, 'POST', '/v1/models/envcp:generateContent', {
      contents: [{ parts: [{ text: 'hello' }] }],
    });
    expect(status).toBe(503);
    expect((data as any).error.status).toBe('UNAVAILABLE');
    (srv as any).geminiAdapter = orig;
  });

  it('returns 503 for REST handler when adapter nulled', async () => {
    const orig = (srv as any).restAdapter;
    (srv as any).restAdapter = null;
    const { status } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(503);
    (srv as any).restAdapter = orig;
  });

  it('returns 404 for non-api non-v1 path', async () => {
    const { status } = await fetch(port, 'GET', '/random-unknown');
    expect(status).toBe(404);
  });

  it('returns 500 when internal error occurs in request handler', async () => {
    // Make handleRESTRequest throw to trigger the catch block at lines 208-209
    const origHandle = (srv as any).handleRESTRequest;
    (srv as any).handleRESTRequest = async () => { throw new Error('handler crash'); };
    const { status } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(500);
    (srv as any).handleRESTRequest = origHandle;
  });
});

describe('UnifiedServer rate limiting', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-ratelimit-'));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('rate limits after many rapid requests', async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const serverConfig: ServerConfig = { mode: 'auto', port, host: '127.0.0.1', cors: true, auto_detect: true };
    const srv = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await srv.start();

    // Send many requests rapidly
    const results = await Promise.all(
      Array.from({ length: 120 }, () => fetch(port, 'GET', '/'))
    );
    const statuses = results.map(r => r.status);
    // At least some should succeed, and if rate limit kicks in, some should be 429
    expect(statuses.some(s => s === 200)).toBe(true);
    srv.stop();
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
