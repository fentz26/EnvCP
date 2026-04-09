import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
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
    port = 30000 + Math.floor(Math.random() * 10000);
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.remove(tmpDir);
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
});

describe('OpenAIAdapter', () => {
  let tmpDir: string;
  let adapter: OpenAIAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-openai-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = 30000 + Math.floor(Math.random() * 10000);
    await adapter.startServer(port, '127.0.0.1');

    // Seed a variable
    await adapter.callTool('envcp_set', { name: 'OAI_VAR', value: 'test' });
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.remove(tmpDir);
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
    expect((data as any).data[0].id).toBe('envcp-1.0');
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
});

describe('GeminiAdapter', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = 30000 + Math.floor(Math.random() * 10000);
    await adapter.startServer(port, '127.0.0.1');

    await adapter.callTool('envcp_set', { name: 'GEM_VAR', value: 'gemtest' });
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.remove(tmpDir);
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
});
