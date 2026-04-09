import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { OpenAIAdapter } from '../src/adapters/openai';
import { EnvCPConfig } from '../src/types';

const makeConfig = (): EnvCPConfig => ({
  version: '1.0',
  storage: { path: '.envcp/store.json', encrypted: false },
  access: {
    allow_ai_read: true,
    allow_ai_write: true,
    allow_ai_delete: true,
    allow_ai_export: true,
    allow_ai_execute: true,
    allow_ai_active_check: true,
    require_user_reference: false,
    allowed_commands: ['echo'],
    require_confirmation: false,
    mask_values: false,
    audit_log: false,
    blacklist_patterns: [],
  },
  sync: { enabled: false, target: '.env', exclude: [], format: 'dotenv' },
  session: { enabled: false, timeout_minutes: 30, max_extensions: 5, path: '.envcp/.session' },
  encryption: { enabled: false },
  security: { mode: 'recoverable', recovery_file: '.envcp/.recovery' },
  password: { min_length: 1, require_complexity: false, allow_numeric_only: true, allow_single_char: true },
});

describe('OpenAIAdapter', () => {
  let tmpDir: string;
  let adapter: OpenAIAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-openai-test-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    adapter.stopServer();
    await fs.remove(tmpDir);
  });

  describe('getOpenAIFunctions', () => {
    it('returns an array of function definitions', () => {
      const fns = adapter.getOpenAIFunctions();
      expect(Array.isArray(fns)).toBe(true);
      expect(fns.length).toBeGreaterThan(0);
    });

    it('each function has name, description and parameters', () => {
      const fns = adapter.getOpenAIFunctions();
      for (const fn of fns) {
        expect(typeof fn.name).toBe('string');
        expect(typeof fn.description).toBe('string');
        expect(fn.parameters).toBeDefined();
        expect(fn.parameters.type).toBe('object');
      }
    });

    it('includes envcp_list and envcp_get', () => {
      const names = adapter.getOpenAIFunctions().map(f => f.name);
      expect(names).toContain('envcp_list');
      expect(names).toContain('envcp_get');
    });
  });

  describe('processToolCalls', () => {
    beforeEach(async () => {
      await adapter.callTool('envcp_set', { name: 'MY_VAR', value: 'hello' });
    });

    it('processes a valid tool call and returns tool messages', async () => {
      const toolCalls = [
        {
          id: 'call_abc123',
          type: 'function' as const,
          function: {
            name: 'envcp_list',
            arguments: JSON.stringify({}),
          },
        },
      ];

      const results = await adapter.processToolCalls(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('tool');
      expect(results[0].tool_call_id).toBe('call_abc123');
      expect(typeof results[0].content).toBe('string');
    });

    it('returns error message for unknown tool', async () => {
      const toolCalls = [
        {
          id: 'call_xyz',
          type: 'function' as const,
          function: {
            name: 'nonexistent_tool',
            arguments: JSON.stringify({}),
          },
        },
      ];

      const results = await adapter.processToolCalls(toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('tool');
      const content = JSON.parse(results[0].content as string);
      expect(content).toHaveProperty('error');
    });

    it('handles malformed arguments gracefully', async () => {
      const toolCalls = [
        {
          id: 'call_bad',
          type: 'function' as const,
          function: {
            name: 'envcp_list',
            arguments: 'not-valid-json',
          },
        },
      ];

      const results = await adapter.processToolCalls(toolCalls);
      expect(results).toHaveLength(1);
      const content = JSON.parse(results[0].content as string);
      expect(content).toHaveProperty('error');
    });

    it('processes multiple tool calls', async () => {
      await adapter.callTool('envcp_set', { name: 'VAR_A', value: 'val_a' });
      await adapter.callTool('envcp_set', { name: 'VAR_B', value: 'val_b' });

      const toolCalls = [
        { id: 'call_1', type: 'function' as const, function: { name: 'envcp_list', arguments: '{}' } },
        { id: 'call_2', type: 'function' as const, function: { name: 'envcp_list', arguments: '{}' } },
      ];

      const results = await adapter.processToolCalls(toolCalls);
      expect(results).toHaveLength(2);
      expect(results[0].tool_call_id).toBe('call_1');
      expect(results[1].tool_call_id).toBe('call_2');
    });
  });

  describe('HTTP server', () => {
    let port: number;

    const getJson = (url: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> =>
      new Promise((resolve, reject) => {
        const req = http.request(url, { headers }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: data });
            }
          });
        });
        req.on('error', reject);
        req.end();
      });

    const postJson = (url: string, payload: unknown, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> =>
      new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const parsed = new URL(url);
        const req = http.request({
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...headers,
          },
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: data });
            }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });

    beforeEach(async () => {
      port = 49200 + Math.floor(Math.random() * 200);
      await adapter.startServer(port, '127.0.0.1');
    });

    afterEach(() => {
      adapter.stopServer();
    });

    it('GET /v1/models returns model list', async () => {
      const { status, body } = await getJson(`http://127.0.0.1:${port}/v1/models`);
      expect(status).toBe(200);
      expect((body as { data: unknown[] }).data).toBeDefined();
    });

    it('GET /v1/functions returns function list', async () => {
      const { status, body } = await getJson(`http://127.0.0.1:${port}/v1/functions`);
      expect(status).toBe(200);
      expect((body as { data: unknown[] }).data).toBeDefined();
    });

    it('GET /v1/health returns ok', async () => {
      const { status, body } = await getJson(`http://127.0.0.1:${port}/v1/health`);
      expect(status).toBe(200);
      expect((body as { status: string }).status).toBe('ok');
    });

    it('returns 404 for unknown routes', async () => {
      const { status } = await getJson(`http://127.0.0.1:${port}/unknown`);
      expect(status).toBe(404);
    });

    it('POST /v1/functions/call returns error for missing name', async () => {
      const { status } = await postJson(`http://127.0.0.1:${port}/v1/functions/call`, {});
      expect(status).toBe(400);
    });

    it('POST /v1/functions/call calls a tool successfully', async () => {
      const { status, body } = await postJson(`http://127.0.0.1:${port}/v1/functions/call`, {
        name: 'envcp_list',
        arguments: {},
      });
      expect(status).toBe(200);
      expect((body as { name: string }).name).toBe('envcp_list');
    });

    it('rejects requests with invalid API key', async () => {
      adapter.stopServer();
      const secureAdapter = new OpenAIAdapter(makeConfig(), tmpDir);
      await secureAdapter.init();
      const secPort = port + 100;
      await secureAdapter.startServer(secPort, '127.0.0.1', 'secret-api-key');

      try {
        const { status } = await getJson(`http://127.0.0.1:${secPort}/v1/models`, {
          'Authorization': 'Bearer wrong-key',
        });
        expect(status).toBe(401);
      } finally {
        secureAdapter.stopServer();
      }
    });

    it('accepts requests with correct API key', async () => {
      adapter.stopServer();
      const secureAdapter = new OpenAIAdapter(makeConfig(), tmpDir);
      await secureAdapter.init();
      const secPort = port + 200;
      await secureAdapter.startServer(secPort, '127.0.0.1', 'valid-key');

      try {
        const { status } = await getJson(`http://127.0.0.1:${secPort}/v1/models`, {
          'Authorization': 'Bearer valid-key',
        });
        expect(status).toBe(200);
      } finally {
        secureAdapter.stopServer();
      }
    });
  });
});
