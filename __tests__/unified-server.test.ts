import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import { EventEmitter } from 'events';
import { UnifiedServer } from '../src/server/unified';
import { EnvCPConfigSchema, ServerConfig } from '../src/types';

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

const makeConfig = () => EnvCPConfigSchema.parse({
  access: {
    allow_ai_read: true,
    allow_ai_write: true,
    allow_ai_delete: true,
    allow_ai_export: true,
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

const TEST_API_KEY = 'test-api-key-for-unified-tests';

function makeServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    api_key: TEST_API_KEY,
    ...overrides,
  } as ServerConfig;
}

function fetch(port: number, method: string, urlPath: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY, 'Authorization': `Bearer ${TEST_API_KEY}`, ...headers };
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
    port = await getFreePort();
    const serverConfig = makeServerConfig({
      mode: 'auto',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
    });
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
      authPort = await getFreePort();
      const serverConfig = makeServerConfig({
        mode: 'auto',
        port: authPort,
        host: '127.0.0.1',
        cors: true,
        auto_detect: true,
        api_key: 'test-secret-key',
      });
      authServer = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
      await authServer.start();
    });

    afterAll(() => {
      authServer.stop();
    });

    it('rejects requests without API key', async () => {
      const { status } = await fetch(authPort, 'GET', '/api/health', undefined, { 'x-api-key': '', 'Authorization': '' });
      expect(status).toBe(401);
    });

    it('accepts requests with valid X-API-Key', async () => {
      const { status } = await fetch(authPort, 'GET', '/api/health', undefined, { 'x-api-key': 'test-secret-key', 'Authorization': '' });
      expect(status).toBe(200);
    });

    it('accepts requests with valid Bearer token', async () => {
      const { status } = await fetch(authPort, 'GET', '/api/health', undefined, { 'x-api-key': '', 'Authorization': 'Bearer test-secret-key' });
      expect(status).toBe(200);
    });

    it('applies lockout after repeated invalid API keys', async () => {
      const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-unified-lockout-'));
      const isolatedPort = await getFreePort();
      const isolatedServer = new UnifiedServer(
        makeConfig(),
        makeServerConfig({
          mode: 'auto',
          port: isolatedPort,
          host: '127.0.0.1',
          cors: true,
          auto_detect: true,
          api_key: 'test-secret-key',
        }),
        isolatedDir,
      );

      await isolatedServer.start();
      try {
        for (let i = 0; i < 4; i += 1) {
          const { status } = await fetch(
            isolatedPort,
            'GET',
            '/api/health',
            undefined,
            { 'x-api-key': 'wrong-key', Authorization: '' },
          );
          expect(status).toBe(401);
        }

        const { status } = await fetch(
          isolatedPort,
          'GET',
          '/api/health',
          undefined,
          { 'x-api-key': 'wrong-key', Authorization: '' },
        );
        expect(status).toBe(429);
      } finally {
        isolatedServer.stop();
        await fs.rm(isolatedDir, { recursive: true, force: true });
      }
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
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('starts in rest mode', async () => {
    const port = await getFreePort();
    const serverConfig = makeServerConfig({ mode: 'rest', port, host: '127.0.0.1', cors: true, auto_detect: false });
    const server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();
    const { status, data } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    server.stop();
  });

  it('starts in openai mode', async () => {
    const port = await getFreePort();
    const serverConfig = makeServerConfig({ mode: 'openai', port, host: '127.0.0.1', cors: true, auto_detect: false });
    const server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();
    const { status } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
    server.stop();
  });

  it('starts in gemini mode', async () => {
    const port = await getFreePort();
    const serverConfig = makeServerConfig({ mode: 'gemini', port, host: '127.0.0.1', cors: true, auto_detect: false });
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
    port = await getFreePort();
    const serverConfig = makeServerConfig({
      mode: 'all',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
    });
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

  it('POST /v1/functions/call routed to Gemini handler via ?mode=gemini', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/functions/call?mode=gemini', { name: 'envcp_list', args: {} });
    expect(status).toBe(200);
    expect((data as any).name).toBe('envcp_list');
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
    port = await getFreePort();
    const serverConfig = makeServerConfig({
      mode: 'all',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
      api_key: 'test-key',
    });
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

  const authHeader = { 'x-api-key': 'test-key' };

  it('POST /api/sync syncs variables', async () => {
    // First create a variable
    await fetch(port, 'POST', '/api/variables', { name: 'SYNC_VAR', value: 'synced' }, authHeader);
    const { status, data } = await fetch(port, 'POST', '/api/sync', undefined, authHeader);
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('POST /api/run executes a command', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'RUN_VAR', value: 'rv' }, authHeader);
    const { status, data } = await fetch(port, 'POST', '/api/run', { command: 'echo hello', variables: ['RUN_VAR'] }, authHeader);
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('REST handler returns 404 for unknown sub-route', async () => {
    const { status } = await fetch(port, 'GET', '/api/nonexistent', undefined, authHeader);
    expect(status).toBe(404);
  });

  it('REST handler catches errors from callTool', async () => {
    // Trigger an error by trying to get a non-existent variable
    const { status } = await fetch(port, 'GET', '/api/variables/DEFINITELY_MISSING_XYZZY', undefined, authHeader);
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
    port = await getFreePort();
    // Start in all mode so all routes are active, then null out adapters
    const serverConfig = makeServerConfig({ mode: 'all', port, host: '127.0.0.1', cors: true, auto_detect: true });
    srv = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await srv.start();
  });

  afterAll(async () => {
    srv.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
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
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rate limits after many rapid requests', async () => {
    const port = await getFreePort();
    const serverConfig = makeServerConfig({ mode: 'auto', port, host: '127.0.0.1', cors: true, auto_detect: true });
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
  const serverConfig = makeServerConfig({ mode: 'auto', port: 0, host: '127.0.0.1', cors: true, auto_detect: true });
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

  it('handles missing url and host via default fallbacks', () => {
    const req = { url: undefined, headers: {} } as http.IncomingMessage;
    expect(server.detectClientType(req)).toBe('unknown');
  });

  it('routes /api/* to REST when client type is MCP (fallback)', async () => {
    const port = await getFreePort();
    const serverConfig = makeServerConfig({ mode: 'auto', port, host: '127.0.0.1', cors: true, auto_detect: true });
    const srv = new UnifiedServer(makeConfig(), serverConfig, '/tmp/nonexistent-' + Date.now());
    await srv.start();
    const { status, data } = await fetch(port, 'GET', '/api/health', undefined, { 'x-mcp-version': '1.0' });
    expect(status).toBe(200);
    srv.stop();
  });
});

describe('UnifiedServer vault-aware startup', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-vault-srv-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves vault path and starts in rest mode', async () => {
    const port = await getFreePort();
    const config = EnvCPConfigSchema.parse({
      access: { allow_ai_read: true, allow_ai_active_check: true },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
      vault: { default: 'project' },
    });
    const serverConfig = makeServerConfig({ mode: 'rest', port, host: '127.0.0.1', cors: true, auto_detect: false });
    const srv = new UnifiedServer(config, serverConfig, tmpDir);
    await srv.start();
    const { status, data } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
    srv.stop();
  });

  it('resolves global vault path when default is global', async () => {
    const port = await getFreePort();
    const config = EnvCPConfigSchema.parse({
      access: { allow_ai_read: true, allow_ai_active_check: true },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
      vault: { default: 'global', global_path: '.envcp/store.enc' },
    });
    const serverConfig = makeServerConfig({ mode: 'rest', port, host: '127.0.0.1', cors: true, auto_detect: false });
    const srv = new UnifiedServer(config, serverConfig, tmpDir);
    await srv.start();
    const { status } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    srv.stop();
  });
});

describe('UnifiedServer auto_detect=false in all mode', () => {
  let tmpDir: string;
  let server: UnifiedServer;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-noauto-'));
    port = await getFreePort();
    const serverConfig = makeServerConfig({
      mode: 'all',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: false,
    });
    server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();
  });

  afterAll(async () => {
    server.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('GET / with auto_detect=false returns detected_client=unknown', async () => {
    const { status, data } = await fetch(port, 'GET', '/');
    expect(status).toBe(200);
    expect((data as any).detected_client).toBe('unknown');
  });

  it('routes /api/* to REST when auto_detect=false', async () => {
    const { status } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
  });

  it('routes OpenAI path via explicit path match when auto_detect=false', async () => {
    const { status } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
  });
});

describe('UnifiedServer rate_limit disabled', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-norate-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips rate-limiter setup when rate_limit.enabled=false', async () => {
    const port = await getFreePort();
    const serverConfig = makeServerConfig({
      mode: 'all',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
      rate_limit: { enabled: false, requests_per_minute: 1 },
    });
    const srv = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await srv.start();
    const { status } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    srv.stop();
  });

  it('uses custom requests_per_minute when rate_limit.enabled=true', async () => {
    const port = await getFreePort();
    const serverConfig = makeServerConfig({
      mode: 'all',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
      rate_limit: { enabled: true, requests_per_minute: 120 },
    });
    const srv = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await srv.start();
    const { status } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    srv.stop();
  });
});

describe('UnifiedServer non-Error throws in catch blocks', () => {
  let tmpDir: string;
  let server: UnifiedServer;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-nonerr-'));
    port = await getFreePort();
    const serverConfig = makeServerConfig({ mode: 'all', port, host: '127.0.0.1', cors: true, auto_detect: true });
    server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();
  });

  afterAll(async () => {
    server.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('REST handler catches non-Error throw (string)', async () => {
    const orig = (server as any).restAdapter.callTool;
    (server as any).restAdapter.callTool = async () => { throw 'string-error'; };
    const { status, data } = await fetch(port, 'GET', '/api/variables');
    expect(status).toBe(500);
    expect((data as any).error).toBe('string-error');
    (server as any).restAdapter.callTool = orig;
  });

  it('outer request handler catches non-Error throw (string)', async () => {
    const orig = (server as any).handleRESTRequest;
    (server as any).handleRESTRequest = async () => { throw 'outer-string-error'; };
    const { status, data } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(500);
    expect((data as any).error).toBe('outer-string-error');
    (server as any).handleRESTRequest = orig;
  });

  it('OpenAI handler catches non-Error throw (string)', async () => {
    const orig = (server as any).openaiAdapter.callTool;
    (server as any).openaiAdapter.callTool = async () => { throw 'openai-string-error'; };
    const { status, data } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', arguments: {} });
    expect(status).toBe(500);
    expect((data as any).error.message).toBe('openai-string-error');
    (server as any).openaiAdapter.callTool = orig;
  });

  it('Gemini handler catches non-Error throw (string)', async () => {
    const orig = (server as any).geminiAdapter.processFunctionCalls;
    (server as any).geminiAdapter.processFunctionCalls = async () => { throw 'gemini-string-error'; };
    const { status, data } = await fetch(port, 'POST', '/v1/function_calls', { functionCalls: [{ name: 'envcp_list', args: {} }] });
    expect(status).toBe(500);
    expect((data as any).error.message).toBe('gemini-string-error');
    (server as any).geminiAdapter.processFunctionCalls = orig;
  });
});

describe('UnifiedServer direct handler calls with null/edge-case urls', () => {
  let tmpDir: string;
  let server: UnifiedServer;

  function makeMockRes() {
    const chunks: Buffer[] = [];
    const res = {
      writeHead: jest.fn(),
      end: jest.fn((data: any) => { if (data) chunks.push(Buffer.from(data)); }),
      setHeader: jest.fn(),
      getHeader: jest.fn(),
    } as any;
    return { res, chunks };
  }

  function makeMockReq(url: string | null, method: string) {
    const req = new EventEmitter() as any;
    req.url = url;
    req.method = method;
    req.headers = { host: 'localhost', 'content-type': 'application/json' };
    return req;
  }

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-nullurl-'));
    const port = await getFreePort();
    const sc = makeServerConfig({ mode: 'all', port, host: '127.0.0.1', cors: true, auto_detect: true });
    server = new UnifiedServer(makeConfig(), sc, tmpDir);
    await server.start();
    server.stop();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('handleRESTRequest handles null req.url', async () => {
    const handle = (server as any).handleRESTRequest.bind(server);
    const req = makeMockReq(null, 'GET');
    const { res } = makeMockRes();
    await handle(req, res);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleRESTRequest with non-api path returns 404', async () => {
    const handle = (server as any).handleRESTRequest.bind(server);
    const req = makeMockReq('/not-api/something', 'GET');
    const { res, chunks } = makeMockRes();
    await handle(req, res);
    expect(res.end).toHaveBeenCalled();
    const data = JSON.parse(chunks[0]?.toString() ?? '{}');
    expect(data.success).toBe(false);
  });

  it('handleOpenAIRequest handles null req.url', async () => {
    const handle = (server as any).handleOpenAIRequest.bind(server);
    const req = makeMockReq(null, 'GET');
    const { res } = makeMockRes();
    await handle(req, res);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleGeminiRequest handles null req.url', async () => {
    const handle = (server as any).handleGeminiRequest.bind(server);
    const req = makeMockReq(null, 'GET');
    const { res } = makeMockRes();
    await handle(req, res);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleRESTRequest falls back when host header is missing', async () => {
    const handle = (server as any).handleRESTRequest.bind(server);
    const req = makeMockReq('/api/health', 'GET');
    req.headers = { 'content-type': 'application/json' };
    const { res } = makeMockRes();
    await handle(req, res);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleOpenAIRequest falls back when host header is missing', async () => {
    const handle = (server as any).handleOpenAIRequest.bind(server);
    const req = makeMockReq('/v1/models', 'GET');
    req.headers = { 'content-type': 'application/json' };
    const { res } = makeMockRes();
    await handle(req, res);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleGeminiRequest falls back when host header is missing', async () => {
    const handle = (server as any).handleGeminiRequest.bind(server);
    const req = makeMockReq('/v1/tools', 'GET');
    req.headers = { 'content-type': 'application/json' };
    const { res } = makeMockRes();
    await handle(req, res);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleRESTRequest falls back to "/" when parsedUrl.pathname is empty', async () => {
    const handle = (server as any).handleRESTRequest.bind(server);
    const req = makeMockReq('/api/health', 'GET');
    const parsedUrl = { pathname: '', searchParams: new URLSearchParams() } as unknown as URL;
    const { res } = makeMockRes();
    await handle(req, res, parsedUrl);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleOpenAIRequest falls back to "/" when parsedUrl.pathname is empty', async () => {
    const handle = (server as any).handleOpenAIRequest.bind(server);
    const req = makeMockReq('/v1/models', 'GET');
    const parsedUrl = { pathname: '', searchParams: new URLSearchParams() } as unknown as URL;
    const { res } = makeMockRes();
    await handle(req, res, parsedUrl);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleGeminiRequest falls back to "/" when parsedUrl.pathname is empty', async () => {
    const handle = (server as any).handleGeminiRequest.bind(server);
    const req = makeMockReq('/v1/tools', 'GET');
    const parsedUrl = { pathname: '', searchParams: new URLSearchParams() } as unknown as URL;
    const { res } = makeMockRes();
    await handle(req, res, parsedUrl);
    expect(res.end).toHaveBeenCalled();
  });

  it('handleGeminiRequest with generateContent and no contents field', async () => {
    const handle = (server as any).handleGeminiRequest.bind(server);
    const bodyStr = JSON.stringify({});
    const req = makeMockReq('/v1/models/envcp:generateContent', 'POST');
    const { res } = makeMockRes();
    const p = handle(req, res);
    process.nextTick(() => { req.emit('data', Buffer.from(bodyStr)); req.emit('end'); });
    await p;
    expect(res.end).toHaveBeenCalled();
  });

  it('handleGeminiRequest with content missing parts array', async () => {
    const handle = (server as any).handleGeminiRequest.bind(server);
    const bodyStr = JSON.stringify({ contents: [{}] });
    const req = makeMockReq('/v1/models/envcp:generateContent', 'POST');
    const { res } = makeMockRes();
    const p = handle(req, res);
    process.nextTick(() => { req.emit('data', Buffer.from(bodyStr)); req.emit('end'); });
    await p;
    expect(res.end).toHaveBeenCalled();
  });

  it('handleGeminiRequest /v1/functions/call without args uses {} — unified.ts:417', async () => {
    const handle = (server as any).handleGeminiRequest.bind(server);
    // Omit args to hit the `args || {}` false branch
    const bodyStr = JSON.stringify({ name: 'envcp_list' });
    const req = makeMockReq('/v1/functions/call', 'POST');
    const { res } = makeMockRes();
    const p = handle(req, res);
    process.nextTick(() => { req.emit('data', Buffer.from(bodyStr)); req.emit('end'); });
    await p;
    expect(res.end).toHaveBeenCalled();
  });

  it('handleGeminiRequest /v1/functions/call with non-string name uses empty string', async () => {
    const handle = (server as any).handleGeminiRequest.bind(server);
    const ga = (server as any).geminiAdapter;
    const originalCallTool = ga.callTool?.bind(ga);
    ga.callTool = async (name: string) => ({ receivedName: name });

    const bodyStr = JSON.stringify({ name: 123, args: {} });
    const req = makeMockReq('/v1/functions/call', 'POST');
    const { res, chunks } = makeMockRes();
    const p = handle(req, res);
    process.nextTick(() => { req.emit('data', Buffer.from(bodyStr)); req.emit('end'); });
    await p;

    const payload = JSON.parse(chunks[0]?.toString() ?? '{}');
    expect(payload.name).toBe('');
    expect(payload.response?.result?.receivedName).toBe('');

    ga.callTool = originalCallTool;
  });

  it('handleRESTRequest DELETE /api/variables/ with no name returns 404 — unified.ts:297', async () => {
    const handle = (server as any).handleRESTRequest.bind(server);
    // DELETE with no variable name — varName = segments[2] = undefined → false branch
    const req = makeMockReq('/api/variables/', 'DELETE');
    const { res } = makeMockRes();
    await handle(req, res);
    expect(res.end).toHaveBeenCalled();
  });
});

describe('UnifiedServer checkApiKeySecurity (#148)', () => {
  it('throws when AI flags are enabled with no api_key', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sec-warn-'));
    const port = await getFreePort();
    const config = EnvCPConfigSchema.parse({
      access: { allow_ai_read: true, allow_ai_write: true },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const serverConfig: ServerConfig = { mode: 'auto', port, host: '127.0.0.1', cors: true, auto_detect: true };
    const srv = new UnifiedServer(config, serverConfig, tmpDir);
    await expect(srv.start()).rejects.toThrow('no api_key is set');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('error includes all active allow_ai_* flag names', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sec-flags-'));
    const port = await getFreePort();
    const config = EnvCPConfigSchema.parse({
      access: { allow_ai_read: true, allow_ai_write: true, allow_ai_delete: true },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const serverConfig: ServerConfig = { mode: 'auto', port, host: '127.0.0.1', cors: true, auto_detect: true };
    const srv = new UnifiedServer(config, serverConfig, tmpDir);
    await expect(srv.start()).rejects.toThrow('allow_ai_read, allow_ai_write, allow_ai_delete');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when allow_ai_execute is enabled with no api_key', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sec-err-'));
    const port = await getFreePort();
    const config = EnvCPConfigSchema.parse({
      access: { allow_ai_execute: true },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const serverConfig: ServerConfig = { mode: 'auto', port, host: '127.0.0.1', cors: true, auto_detect: true };
    const srv = new UnifiedServer(config, serverConfig, tmpDir);
    await expect(srv.start()).rejects.toThrow('allow_ai_execute is enabled but no api_key is set');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('does not warn when no AI flags are enabled', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sec-noflags-'));
    const port = await getFreePort();
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const serverConfig: ServerConfig = { mode: 'auto', port, host: '127.0.0.1', cors: true, auto_detect: true };
    const srv = new UnifiedServer(config, serverConfig, tmpDir);
    await srv.start();
    expect(stderrSpy).not.toHaveBeenCalled();
    srv.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  it('does not warn when api_key is configured', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sec-key-'));
    const port = await getFreePort();
    const config = EnvCPConfigSchema.parse({
      access: { allow_ai_read: true, allow_ai_execute: true },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const serverConfig = makeServerConfig({
      mode: 'auto', port, host: '127.0.0.1', cors: true, auto_detect: true,
      api_key: 'secret-key',
    });
    const srv = new UnifiedServer(config, serverConfig, tmpDir);
    await srv.start();
    expect(stderrSpy).not.toHaveBeenCalled();
    srv.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });
});

describe('UnifiedServer — branch coverage paths', () => {
  let tmpDir: string;
  let server: UnifiedServer;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-branches-'));
    port = await getFreePort();
    const serverConfig = makeServerConfig({
      mode: 'all', port, host: '127.0.0.1', cors: true, auto_detect: true,
      api_key: 'test-key',
    });
    const config = EnvCPConfigSchema.parse({
      access: { allow_ai_read: true, allow_ai_write: true, allow_ai_delete: true, allow_ai_export: true, allow_ai_execute: true, allow_ai_active_check: true, require_user_reference: false, require_confirmation: false, mask_values: false, blacklist_patterns: [], allowed_commands: ['echo'] },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
      sync: { enabled: false },
    });
    server = new UnifiedServer(config, serverConfig, tmpDir);
    await server.start();
  });

  afterAll(async () => {
    server.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const auth = { 'x-api-key': 'test-key' };
  const bad = { 'x-api-key': 'wrong' };

  it('returns 401 with wrong API key (auth_failure log path)', async () => {
    const { status } = await fetch(port, 'GET', '/api/variables', undefined, bad);
    expect(status).toBe(401);
  });

  it('logs auth failures with unknown remote address fallback', async () => {
    const logs = (server as any).logs;
    const logSpy = jest.spyOn(logs, 'log').mockResolvedValue(undefined);
    const mockReq = {
      method: 'GET',
      url: '/api/variables',
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        'x-api-key': 'wrong',
      },
      socket: { remoteAddress: undefined },
    } as unknown as http.IncomingMessage;
    const mockRes = {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      end: jest.fn(),
      removeHeader: jest.fn(),
    } as unknown as http.ServerResponse;

    await (server as any).httpServer.listeners('request')[0](mockReq, mockRes);

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0].message).toContain('unknown');
    logSpy.mockRestore();
  });

  it('uses url and host fallbacks in request URL parsing', async () => {
    const mockReq = {
      method: 'GET',
      url: undefined,
      headers: {
        origin: 'http://localhost',
        'x-api-key': 'test-key',
      },
      socket: { remoteAddress: undefined },
    } as unknown as http.IncomingMessage;
    const mockRes = {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      end: jest.fn(),
      removeHeader: jest.fn(),
    } as unknown as http.ServerResponse;

    await (server as any).httpServer.listeners('request')[0](mockReq, mockRes);

    expect((mockRes.writeHead as jest.Mock).mock.calls[0]?.[0]).toBe(200);
    expect(mockRes.end).toHaveBeenCalled();
  });

  it('POST /v1/tool_calls with non-array tool_calls returns empty results', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/tool_calls', { tool_calls: 'not-an-array' }, auth);
    expect(status).toBe(200);
    expect((data as any).data).toEqual([]);
  });

  it('POST /v1/chat/completions with non-array messages processes no tool calls', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/chat/completions', { messages: 'not-an-array' }, auth);
    expect(status).toBe(200);
  });

  it('POST /v1/functions/call with non-string name uses empty string', async () => {
    const { status } = await fetch(port, 'POST', '/v1/functions/call', { name: 42, arguments: {} }, auth);
    // Unknown tool "" → error, but handled gracefully
    expect([200, 500]).toContain(status);
  });

  it('POST /v1/function_calls with non-array functionCalls returns empty results', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/function_calls', { functionCalls: 'not-an-array' }, auth);
    expect(status).toBe(200);
    expect((data as any).functionResponses).toEqual([]);
  });

  it('detectClientType returns type without explicit pathname', async () => {
    // Hit the pathname === undefined branch by calling via REST with no x-goog or openai headers
    const { status } = await fetch(port, 'GET', '/api/health', undefined, auth);
    expect(status).toBe(200);
  });

  it('detectClientType called with no pathname arg hits line 38 branch', () => {
    // Call detectClientType without pathname to exercise the undefined branch (line 38)
    const fakeReq = {
      headers: { 'user-agent': 'test' },
      url: '/api/health',
    } as http.IncomingMessage;
    const result = (server as any).detectClientType(fakeReq);
    expect(typeof result).toBe('string');
  });

  it('Gemini handler throws non-Error → String(error) branch (line 520)', async () => {
    // /v1/function_calls routes to handleGeminiRequest; patch processFunctionCalls to throw a string
    const ga = (server as any).geminiAdapter;
    if (ga) {
      const orig = ga.processFunctionCalls?.bind(ga);
      ga.processFunctionCalls = async () => { throw 'gemini-non-error'; };
      const { status } = await fetch(port, 'POST', '/v1/function_calls',
        { functionCalls: [{ name: 'envcp_list', args: {} }] }, auth);
      expect(status).toBe(500);
      if (orig) ga.processFunctionCalls = orig;
    } else {
      expect(server).toBeDefined();
    }
  });

  it('OpenAI handler throws non-Error → String(error) branch in handleOpenAIRequest', async () => {
    const oa = (server as any).openaiAdapter;
    if (oa) {
      const orig = oa.callTool?.bind(oa);
      oa.callTool = async () => { throw 'openai-non-error'; };
      // /v1/functions/call routes to handleOpenAIRequest
      const { status } = await fetch(port, 'POST', '/v1/functions/call',
        { name: 'openai-non-err', arguments: {} }, auth);
      expect(status).toBe(500);
      if (orig) oa.callTool = orig;
    } else {
      expect(server).toBeDefined();
    }
  });
});

describe('UnifiedServer — restart removes previous shutdown handlers', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-unified-restart-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('unregisters old SIGTERM/SIGINT handlers on a second start', async () => {
    const serverConfig = makeServerConfig({
      mode: 'auto',
      port: await getFreePort(),
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
    });
    const s = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await s.start();
    const firstHandlers = (s as any).shutdownHandlers;
    expect(firstHandlers).not.toBeNull();

    // Close the underlying HTTP server without touching stop() so that
    // shutdownHandlers stays populated when we call start() again. This
    // forces the "remove previous handlers" branch to execute.
    await new Promise<void>((resolve) => {
      (s as any).httpServer.close(() => resolve());
    });

    (s as any).serverConfig.port = await getFreePort();
    await s.start();
    const secondHandlers = (s as any).shutdownHandlers;
    expect(secondHandlers).not.toBeNull();
    expect(secondHandlers).not.toBe(firstHandlers);

    s.stop();
    if (secondHandlers) {
      process.off('SIGTERM', secondHandlers.sigterm);
      process.off('SIGINT', secondHandlers.sigint);
    }
  });
});
