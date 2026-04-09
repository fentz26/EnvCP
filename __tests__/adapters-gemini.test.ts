import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { GeminiAdapter } from '../src/adapters/gemini';
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

describe('GeminiAdapter', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-test-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    adapter.stopServer();
    await fs.remove(tmpDir);
  });

  describe('getGeminiFunctionDeclarations', () => {
    it('returns an array of function declarations', () => {
      const decls = adapter.getGeminiFunctionDeclarations();
      expect(Array.isArray(decls)).toBe(true);
      expect(decls.length).toBeGreaterThan(0);
    });

    it('each declaration has name, description and parameters', () => {
      const decls = adapter.getGeminiFunctionDeclarations();
      for (const decl of decls) {
        expect(typeof decl.name).toBe('string');
        expect(typeof decl.description).toBe('string');
        expect(decl.parameters.type).toBe('object');
        expect(decl.parameters.properties).toBeDefined();
      }
    });

    it('includes envcp_list and envcp_set', () => {
      const names = adapter.getGeminiFunctionDeclarations().map(d => d.name);
      expect(names).toContain('envcp_list');
      expect(names).toContain('envcp_set');
    });
  });

  describe('processFunctionCalls', () => {
    beforeEach(async () => {
      await adapter['callTool']('envcp_set', { name: 'GEM_VAR', value: 'gem_value' });
    });

    it('processes a valid function call', async () => {
      const results = await adapter.processFunctionCalls([
        { name: 'envcp_list', args: {} },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('envcp_list');
      expect(results[0].response).toHaveProperty('result');
    });

    it('returns error response for unknown function', async () => {
      const results = await adapter.processFunctionCalls([
        { name: 'nonexistent_fn', args: {} },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].response).toHaveProperty('error');
    });

    it('processes multiple function calls', async () => {
      const results = await adapter.processFunctionCalls([
        { name: 'envcp_list', args: {} },
        { name: 'envcp_list', args: {} },
      ]);

      expect(results).toHaveLength(2);
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
      port = 49400 + Math.floor(Math.random() * 200);
      await adapter.startServer(port, '127.0.0.1');
    });

    afterEach(() => {
      adapter.stopServer();
    });

    it('GET /v1/models returns model list', async () => {
      const { status, body } = await getJson(`http://127.0.0.1:${port}/v1/models`);
      expect(status).toBe(200);
      expect((body as { models: unknown[] }).models).toBeDefined();
    });

    it('GET /v1/tools returns available tools', async () => {
      const { status, body } = await getJson(`http://127.0.0.1:${port}/v1/tools`);
      expect(status).toBe(200);
      expect((body as { tools: unknown[] }).tools).toBeDefined();
    });

    it('GET /v1/health returns ok', async () => {
      const { status, body } = await getJson(`http://127.0.0.1:${port}/v1/health`);
      expect(status).toBe(200);
      expect((body as { status: string }).status).toBe('ok');
    });

    it('GET / returns health check', async () => {
      const { status, body } = await getJson(`http://127.0.0.1:${port}/`);
      expect(status).toBe(200);
      expect((body as { status: string }).status).toBe('ok');
    });

    it('returns 404 for unknown routes', async () => {
      const { status } = await getJson(`http://127.0.0.1:${port}/unknown`);
      expect(status).toBe(404);
    });

    it('POST /v1/functions/call calls a function successfully', async () => {
      const { status, body } = await postJson(`http://127.0.0.1:${port}/v1/functions/call`, {
        name: 'envcp_list',
        args: {},
      });
      expect(status).toBe(200);
      expect((body as { name: string }).name).toBe('envcp_list');
    });

    it('POST /v1/functions/call returns 400 when name is missing', async () => {
      const { status } = await postJson(`http://127.0.0.1:${port}/v1/functions/call`, {});
      expect(status).toBe(400);
    });

    it('POST /v1/function_calls processes batch function calls', async () => {
      const { status, body } = await postJson(`http://127.0.0.1:${port}/v1/function_calls`, {
        functionCalls: [{ name: 'envcp_list', args: {} }],
      });
      expect(status).toBe(200);
      expect((body as { functionResponses: unknown[] }).functionResponses).toHaveLength(1);
    });

    it('POST /v1/function_calls returns 400 when functionCalls is missing', async () => {
      const { status } = await postJson(`http://127.0.0.1:${port}/v1/function_calls`, {});
      expect(status).toBe(400);
    });

    it('POST generateContent returns available tools when no function calls', async () => {
      const { status, body } = await postJson(
        `http://127.0.0.1:${port}/v1/models/envcp:generateContent`,
        { contents: [{ parts: [{ text: 'hello' }] }] },
      );
      expect(status).toBe(200);
      expect((body as { candidates: unknown[] }).candidates).toBeDefined();
    });

    it('POST generateContent processes function calls in content', async () => {
      const { status, body } = await postJson(
        `http://127.0.0.1:${port}/v1/models/envcp:generateContent`,
        {
          contents: [{
            parts: [{ functionCall: { name: 'envcp_list', args: {} } }],
          }],
        },
      );
      expect(status).toBe(200);
      const candidates = (body as { candidates: Array<{ content: { parts: unknown[] } }> }).candidates;
      expect(candidates[0].content.parts.length).toBeGreaterThan(0);
    });

    it('rejects requests with invalid API key (x-goog-api-key)', async () => {
      adapter.stopServer();
      const secureAdapter = new GeminiAdapter(makeConfig(), tmpDir);
      await secureAdapter.init();
      const secPort = port + 100;
      await secureAdapter.startServer(secPort, '127.0.0.1', 'gemini-secret');

      try {
        const { status } = await getJson(`http://127.0.0.1:${secPort}/v1/models`, {
          'x-goog-api-key': 'wrong-key',
        });
        expect(status).toBe(401);
      } finally {
        secureAdapter.stopServer();
      }
    });
  });
});
