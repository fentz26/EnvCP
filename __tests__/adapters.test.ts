import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}
import { RESTAdapter } from '../src/adapters/rest';
import { OpenAIAdapter } from '../src/adapters/openai';
import { GeminiAdapter } from '../src/adapters/gemini';
import { EnvCPConfig, EnvCPConfigSchema } from '../src/types';

const makeConfig = (): EnvCPConfig => EnvCPConfigSchema.parse({
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

describe('RESTAdapter HTTP server', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-'));
    adapter = new RESTAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/health returns ok', async () => {
    const { status, data } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('GET /api/tools lists tools', async () => {
    const { status, data } = await fetch(port, 'GET', '/api/tools');
    expect(status).toBe(200);
    expect((data as any).data.tools.length).toBeGreaterThan(0);
  });

  it('POST /api/variables creates a variable', async () => {
    const { status, data } = await fetch(port, 'POST', '/api/variables', { name: 'TEST_VAR', value: 'hello' });
    expect(status).toBe(201);
    expect((data as any).success).toBe(true);
  });

  it('GET /api/variables lists variables', async () => {
    const { status, data } = await fetch(port, 'GET', '/api/variables');
    expect(status).toBe(200);
    expect((data as any).data.variables).toContain('TEST_VAR');
  });

  it('GET /api/variables/:name gets a variable', async () => {
    const { status, data } = await fetch(port, 'GET', '/api/variables/TEST_VAR');
    expect(status).toBe(200);
    expect((data as any).data.name).toBe('TEST_VAR');
  });

  it('PUT /api/variables/:name updates a variable', async () => {
    const { status, data } = await fetch(port, 'PUT', '/api/variables/TEST_VAR', { value: 'updated' });
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('DELETE /api/variables/:name deletes a variable', async () => {
    const { status, data } = await fetch(port, 'DELETE', '/api/variables/TEST_VAR');
    expect(status).toBe(200);
    expect((data as any).data.success).toBe(true);
  });

  it('POST /api/tools/:name calls a tool', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'TOOL_TEST', value: 'v' });
    const { status, data } = await fetch(port, 'POST', '/api/tools/envcp_get', { name: 'TOOL_TEST' });
    expect(status).toBe(200);
    expect((data as any).data.name).toBe('TOOL_TEST');
  });

  it('returns 404 for unknown route', async () => {
    const { status } = await fetch(port, 'GET', '/api/unknown');
    expect(status).toBe(404);
  });

  it('getApiDocs returns documentation string', () => {
    expect(adapter.getApiDocs()).toContain('EnvCP REST API');
  });

  it('POST /api/run executes a command', async () => {
    // First set up a config that allows execution
    (adapter as any).config.access.allow_ai_execute = true;
    (adapter as any).config.access.allowed_commands = ['echo'];
    await fetch(port, 'POST', '/api/variables', { name: 'RUN_VAR', value: 'runval' });
    const { status, data } = await fetch(port, 'POST', '/api/run', { command: 'echo hello', variables: ['RUN_VAR'] });
    expect(status).toBe(200);
  });

  it('GET /api/access/:name checks access', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'ACCESS_VAR', value: 'v' });
    const { status, data } = await fetch(port, 'GET', '/api/access/ACCESS_VAR');
    expect(status).toBe(200);
    expect((data as any).data.accessible).toBe(true);
  });
});

describe('RESTAdapter with API key', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-auth-'));
    adapter = new RESTAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'test-api-key');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects requests without API key', async () => {
    const { status } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(401);
  });

  it('accepts requests with valid API key', async () => {
    const { status } = await fetch(port, 'GET', '/api/health', undefined, { 'X-API-Key': 'test-api-key' });
    expect(status).toBe(200);
  });

  it('handles OPTIONS preflight', async () => {
    const { status } = await fetch(port, 'OPTIONS', '/api/health');
    expect(status).toBe(204);
  });
});

describe('OpenAIAdapter', () => {
  let tmpDir: string;
  let adapter: OpenAIAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-openai-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');

    // Seed a variable
    await adapter.callTool('envcp_set', { name: 'OAI_VAR', value: 'test' });
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('getOpenAIFunctions returns function definitions', () => {
    const fns = adapter.getOpenAIFunctions();
    expect(fns.length).toBeGreaterThan(0);
    expect(fns[0]).toHaveProperty('name');
    expect(fns[0]).toHaveProperty('parameters');
  });

  it('processToolCalls processes valid calls', async () => {
    const results = await adapter.processToolCalls([{
      id: 'call_1',
      type: 'function',
      function: { name: 'envcp_get', arguments: JSON.stringify({ name: 'OAI_VAR' }) },
    }]);
    expect(results).toHaveLength(1);
    expect(results[0].role).toBe('tool');
    expect(results[0].tool_call_id).toBe('call_1');
    expect(results[0].content).toContain('OAI_VAR');
  });

  it('processToolCalls handles errors', async () => {
    const results = await adapter.processToolCalls([{
      id: 'call_err',
      type: 'function',
      function: { name: 'envcp_get', arguments: JSON.stringify({ name: 'MISSING' }) },
    }]);
    expect(results[0].content).toContain('error');
  });

  it('GET /v1/models returns model list', async () => {
    const { status, data } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
    expect((data as any).data[0].id).toMatch(/^envcp-\d+\.\d+/);
  });

  it('GET /v1/functions returns functions', async () => {
    const { status, data } = await fetch(port, 'GET', '/v1/functions');
    expect(status).toBe(200);
    expect((data as any).data.length).toBeGreaterThan(0);
  });

  it('POST /v1/functions/call calls a function', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_get', arguments: { name: 'OAI_VAR' } });
    expect(status).toBe(200);
    expect((data as any).result.name).toBe('OAI_VAR');
  });

  it('POST /v1/functions/call returns 400 without name', async () => {
    const { status } = await fetch(port, 'POST', '/v1/functions/call', {});
    expect(status).toBe(400);
  });

  it('POST /v1/tool_calls processes batch calls', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/tool_calls', {
      tool_calls: [{
        id: 'tc_1',
        type: 'function',
        function: { name: 'envcp_list', arguments: '{}' },
      }],
    });
    expect(status).toBe(200);
    expect((data as any).data.length).toBe(1);
  });

  it('POST /v1/tool_calls returns 400 without array', async () => {
    const { status } = await fetch(port, 'POST', '/v1/tool_calls', {});
    expect(status).toBe(400);
  });

  it('POST /v1/chat/completions without tool_calls returns available tools', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(status).toBe(200);
    expect((data as any).available_tools).toBeDefined();
  });

  it('POST /v1/chat/completions returns 400 without messages', async () => {
    const { status } = await fetch(port, 'POST', '/v1/chat/completions', {});
    expect(status).toBe(400);
  });

  it('GET / returns health check', async () => {
    const { status, data } = await fetch(port, 'GET', '/');
    expect(status).toBe(200);
    expect((data as any).mode).toBe('openai');
  });

  it('returns 404 for unknown path', async () => {
    const { status } = await fetch(port, 'GET', '/v1/unknown');
    expect(status).toBe(404);
  });

  it('handles OPTIONS preflight', async () => {
    const { status } = await fetch(port, 'OPTIONS', '/v1/models');
    expect(status).toBe(204);
  });

  it('POST /v1/chat/completions with tool_calls processes them', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/chat/completions', {
      messages: [{
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'tc_chat',
          type: 'function',
          function: { name: 'envcp_list', arguments: '{}' },
        }],
      }],
    });
    expect(status).toBe(200);
    expect((data as any).tool_results).toBeDefined();
  });
});

describe('RESTAdapter sync and error routes', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-sync-'));
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
    adapter = new RESTAdapter(config, tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('POST /api/sync syncs to .env file', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'SYNC_V', value: 'synced' });
    const { status, data } = await fetch(port, 'POST', '/api/sync');
    expect(status).toBe(200);
    expect((data as any).success).toBe(true);
  });

  it('POST /api/run executes command', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'CMD_VAR', value: 'val' });
    const { status, data } = await fetch(port, 'POST', '/api/run', { command: 'echo test', variables: ['CMD_VAR'] });
    expect(status).toBe(200);
  });

  it('maps "not found" errors to 404 status', async () => {
    const { status } = await fetch(port, 'GET', '/api/variables/TOTALLY_MISSING_VAR');
    expect(status).toBe(404);
  });

  it('maps "disabled" errors to 403 status', async () => {
    // Disable AI read dynamically
    (adapter as any).config.access.allow_ai_read = false;
    const { status } = await fetch(port, 'GET', '/api/variables');
    expect(status).toBe(403);
    (adapter as any).config.access.allow_ai_read = true;
  });

  it('POST /api/tools/envcp_add_to_env calls add_to_env handler', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'ADD_REST', value: 'val' });
    const { status, data } = await fetch(port, 'POST', '/api/tools/envcp_add_to_env', { name: 'ADD_REST' });
    expect(status).toBe(200);
    expect((data as any).data.success).toBe(true);
  });

  it('POST /api/tools/envcp_check_access calls check_access handler', async () => {
    await fetch(port, 'POST', '/api/variables', { name: 'CHK_REST', value: 'val' });
    const { status, data } = await fetch(port, 'POST', '/api/tools/envcp_check_access', { name: 'CHK_REST' });
    expect(status).toBe(200);
    expect((data as any).data.accessible).toBe(true);
  });

  it('maps generic errors to 500 status — line 250', async () => {
    // Make callTool throw an error that doesn't contain 'locked', 'not found', or 'disabled'
    const orig = (adapter as any).callTool.bind(adapter);
    (adapter as any).callTool = async () => { throw new Error('unexpected internal failure xyz'); };
    const { status } = await fetch(port, 'GET', '/api/variables');
    expect(status).toBe(500);
    (adapter as any).callTool = orig;
  });
});

describe('OpenAIAdapter with API key', () => {
  let tmpDir: string;
  let adapter: OpenAIAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-auth-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'oai-secret');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects without API key', async () => {
    const { status } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(401);
  });

  it('accepts with valid Bearer token', async () => {
    const { status } = await fetch(port, 'GET', '/v1/models', undefined, { 'Authorization': 'Bearer oai-secret' });
    expect(status).toBe(200);
  });
});

describe('GeminiAdapter', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');

    await adapter.callTool('envcp_set', { name: 'GEM_VAR', value: 'gemtest' });
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('getGeminiFunctionDeclarations returns declarations', () => {
    const decls = adapter.getGeminiFunctionDeclarations();
    expect(decls.length).toBeGreaterThan(0);
    expect(decls[0]).toHaveProperty('name');
  });

  it('processFunctionCalls processes valid calls', async () => {
    const results = await adapter.processFunctionCalls([
      { name: 'envcp_get', args: { name: 'GEM_VAR' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('envcp_get');
    expect(results[0].response.result).toBeDefined();
  });

  it('processFunctionCalls handles errors', async () => {
    const results = await adapter.processFunctionCalls([
      { name: 'envcp_get', args: { name: 'MISSING' } },
    ]);
    expect(results[0].response.error).toBeDefined();
  });

  it('GET /v1/models returns models', async () => {
    const { status, data } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
    expect((data as any).models[0].name).toContain('envcp');
  });

  it('GET /v1/tools returns tool declarations', async () => {
    const { status, data } = await fetch(port, 'GET', '/v1/tools');
    expect(status).toBe(200);
    expect((data as any).tools[0].functionDeclarations.length).toBeGreaterThan(0);
  });

  it('POST /v1/functions/call calls a function', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_get', args: { name: 'GEM_VAR' } });
    expect(status).toBe(200);
    expect((data as any).response.result).toBeDefined();
  });

  it('POST /v1/functions/call returns 400 without name', async () => {
    const { status } = await fetch(port, 'POST', '/v1/functions/call', {});
    expect(status).toBe(400);
  });

  it('POST /v1/function_calls processes batch', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/function_calls', {
      functionCalls: [{ name: 'envcp_list', args: {} }],
    });
    expect(status).toBe(200);
    expect((data as any).functionResponses.length).toBe(1);
  });

  it('POST /v1/function_calls returns 400 without array', async () => {
    const { status } = await fetch(port, 'POST', '/v1/function_calls', {});
    expect(status).toBe(400);
  });

  it('POST generateContent with function calls', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/models/envcp:generateContent', {
      contents: [{ parts: [{ functionCall: { name: 'envcp_list', args: {} } }] }],
    });
    expect(status).toBe(200);
    expect((data as any).candidates[0].content.parts.length).toBe(1);
  });

  it('POST generateContent without function calls returns tools', async () => {
    const { status, data } = await fetch(port, 'POST', '/v1/models/envcp:generateContent', {
      contents: [{ parts: [{ text: 'hello' }] }],
    });
    expect(status).toBe(200);
    expect((data as any).availableTools).toBeDefined();
  });

  it('GET / returns health check', async () => {
    const { status, data } = await fetch(port, 'GET', '/');
    expect(status).toBe(200);
    expect((data as any).mode).toBe('gemini');
  });

  it('returns 404 for unknown path', async () => {
    const { status } = await fetch(port, 'GET', '/v1/unknown');
    expect(status).toBe(404);
  });

  it('handles OPTIONS preflight', async () => {
    const { status } = await fetch(port, 'OPTIONS', '/v1/tools');
    expect(status).toBe(204);
  });
});

describe('GeminiAdapter error handling', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-err-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 500 when callTool throws in /v1/functions/call', async () => {
    const orig = adapter.callTool.bind(adapter);
    (adapter as any).callTool = async () => { throw new Error('gemini boom'); };
    const { status, data } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', args: {} });
    expect(status).toBe(500);
    expect((data as any).error.status).toBe('INTERNAL');
    (adapter as any).callTool = orig;
  });
});

describe('OpenAIAdapter error handling', () => {
  let tmpDir: string;
  let adapter: OpenAIAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-err-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 500 when callTool throws in /v1/functions/call', async () => {
    const orig = adapter.callTool.bind(adapter);
    (adapter as any).callTool = async () => { throw new Error('openai boom'); };
    const { status, data } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', arguments: {} });
    expect(status).toBe(500);
    expect((data as any).error.type).toBe('internal_error');
    (adapter as any).callTool = orig;
  });
});

describe('Adapter rate limiting', () => {
  it('REST adapter rate limits after many requests', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-rl-'));
    const adapter = new RESTAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');

    // Send 120 rapid requests to trigger rate limit (default is 100/min)
    const results = await Promise.all(
      Array.from({ length: 120 }, () => fetch(port, 'GET', '/api/health'))
    );
    const statuses = results.map(r => r.status);
    expect(statuses.some(s => s === 429)).toBe(true);
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('OpenAI adapter rate limits after many requests', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-rl-'));
    const adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');

    const results = await Promise.all(
      Array.from({ length: 120 }, () => fetch(port, 'GET', '/v1/models'))
    );
    const statuses = results.map(r => r.status);
    expect(statuses.some(s => s === 429)).toBe(true);
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('Gemini adapter rate limits after many requests', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gem-rl-'));
    const adapter = new GeminiAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');

    const results = await Promise.all(
      Array.from({ length: 120 }, () => fetch(port, 'GET', '/v1/models'))
    );
    const statuses = results.map(r => r.status);
    expect(statuses.some(s => s === 429)).toBe(true);
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe('GeminiAdapter with API key', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gem-auth-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'gem-secret');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects without API key', async () => {
    const { status } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(401);
  });

  it('accepts with x-goog-api-key header', async () => {
    const { status } = await fetch(port, 'GET', '/v1/models', undefined, { 'x-goog-api-key': 'gem-secret' });
    expect(status).toBe(200);
  });
});

describe('Adapter rateLimitEnabled=false branch', () => {
  it('REST adapter allows requests when rate limit disabled — rest.ts:103', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-norate-'));
    const adapter = new RESTAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', undefined, { enabled: false, requests_per_minute: 1 });
    const { status } = await fetch(port, 'GET', '/api/health');
    expect(status).toBe(200);
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('OpenAI adapter allows requests when rate limit disabled — openai.ts:62', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-norate-'));
    const adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', undefined, { enabled: false, requests_per_minute: 1 });
    const { status } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('Gemini adapter allows requests when rate limit disabled — gemini.ts:59', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gem-norate-'));
    const adapter = new GeminiAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', undefined, { enabled: false, requests_per_minute: 1 });
    const { status } = await fetch(port, 'GET', '/v1/models');
    expect(status).toBe(200);
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe('RESTAdapter non-api path and edge-case routes', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-edge-'));
    adapter = new RESTAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
    await adapter.callTool('envcp_set', { name: 'EDGE_VAR', value: 'edgeval' });
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('GET / returns 404 (non-api path — rest.ts:147 false branch)', async () => {
    const { status } = await fetch(port, 'GET', '/');
    expect(status).toBe(404);
  });

  it('GET /api/variables?tags=foo filters by tag (rest.ts:186 true branch)', async () => {
    const { status } = await fetch(port, 'GET', '/api/variables?tags=foo');
    expect(status).toBe(200);
  });

  it('DELETE /api/variables/ without name returns 404 (rest.ts:213 false branch)', async () => {
    const { status } = await fetch(port, 'DELETE', '/api/variables/');
    expect(status).toBe(404);
  });
});

describe('OpenAI adapter edge cases', () => {
  let tmpDir: string;
  let adapter: OpenAIAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-edge-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('processToolCalls handles non-Error throw (openai.ts:45 false branch)', async () => {
    const orig = (adapter as any).callTool.bind(adapter);
    (adapter as any).callTool = async () => { throw 'string error'; };
    const results = await adapter.processToolCalls([{
      id: 'call_str',
      type: 'function',
      function: { name: 'envcp_list', arguments: '{}' },
    }]);
    expect(results[0].content).toContain('error');
    (adapter as any).callTool = orig;
  });

  it('POST /v1/functions/call without arguments uses empty object (openai.ts:129)', async () => {
    const { status } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list' });
    expect(status).toBe(200);
  });

  it('non-Error thrown in HTTP handler returns 500 (openai.ts:227 false branch)', async () => {
    const orig = (adapter as any).callTool.bind(adapter);
    (adapter as any).callTool = async () => { throw 'non-error-string'; };
    const { status } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', arguments: {} });
    expect(status).toBe(500);
    (adapter as any).callTool = orig;
  });
});

describe('GeminiAdapter edge cases', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gem-edge-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('processFunctionCalls handles non-Error throw (gemini.ts:43 false branch)', async () => {
    const orig = (adapter as any).callTool.bind(adapter);
    (adapter as any).callTool = async () => { throw 'gemini string error'; };
    const results = await adapter.processFunctionCalls([{ name: 'envcp_list', args: {} }]);
    expect(results[0].response).toHaveProperty('error');
    (adapter as any).callTool = orig;
  });
});

describe('Auth failure — REST adapter', () => {
  let tmpDir: string;
  let port: number;
  let adapter: RESTAdapter;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-auth-'));
    adapter = new RESTAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'correct-key');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 401 with wrong API key', async () => {
    const { status } = await fetch(port, 'GET', '/api/variables', undefined, { 'x-api-key': 'wrong-key' });
    expect(status).toBe(401);
  });
});

describe('Auth failure — OpenAI adapter', () => {
  let tmpDir: string;
  let port: number;
  let adapter: OpenAIAdapter;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-auth-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'correct-key');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 401 with wrong API key', async () => {
    const { status } = await fetch(port, 'GET', '/v1/models', undefined, { 'authorization': 'Bearer wrong-key' });
    expect(status).toBe(401);
  });
});

describe('Auth failure — Gemini adapter', () => {
  let tmpDir: string;
  let port: number;
  let adapter: GeminiAdapter;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gem-auth-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'correct-key');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 401 with wrong API key', async () => {
    const { status } = await fetch(port, 'GET', '/v1/tools', undefined, { 'x-goog-api-key': 'wrong-key' });
    expect(status).toBe(401);
  });
});

describe('REST adapter — non-Error throw in catch (lines 249-250)', () => {
  let tmpDir: string;
  let port: number;
  let adapter: RESTAdapter;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-noe-'));
    adapter = new RESTAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 500 when tool throws a non-Error string (String(error) branch)', async () => {
    // Patch listVariables to throw a plain string
    (adapter as any).listVariables = async () => { throw 'string error from list'; };
    const { status } = await fetch(port, 'GET', '/api/variables');
    expect(status).toBe(500);
    // Restore
    delete (adapter as any).listVariables;
  });
});

describe('OpenAI adapter — non-Error throw in catch (line 91 branch)', () => {
  let tmpDir: string;
  let port: number;
  let adapter: OpenAIAdapter;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-noe-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 500 when callTool throws a non-Error string', async () => {
    (adapter as any).callTool = async () => { throw 'string openai error'; };
    const { status } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', arguments: {} });
    expect(status).toBe(500);
  });
});

describe('Gemini adapter — non-Error throw in catch (line 218 branch)', () => {
  let tmpDir: string;
  let port: number;
  let adapter: GeminiAdapter;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gem-noe-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 500 when callTool throws a non-Error string', async () => {
    (adapter as any).callTool = async () => { throw 'string gemini error'; };
    const { status } = await fetch(port, 'POST', '/v1/functions/call', { name: 'envcp_list', args: {} });
    expect(status).toBe(500);
  });
});
