/**
 * Branch-coverage tests for adapter files (gemini.ts, openai.ts, rest.ts).
 * Each test targets a specific uncovered branch identified in the coverage report.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import { EventEmitter } from 'events';
import { GeminiAdapter } from '../src/adapters/gemini';
import { OpenAIAdapter } from '../src/adapters/openai';
import { RESTAdapter } from '../src/adapters/rest';
import { BaseAdapter } from '../src/adapters/base';
import { EnvCPConfig, EnvCPConfigSchema, ToolDefinition } from '../src/types';

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function fetchHttp(
  port: number,
  method: string,
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers: reqHeaders },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode!, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode!, data }); }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function makeMockResponse() {
  let statusCode: number | undefined;
  let body = '';

  const res = {
    setHeader: (_name: string, _value: unknown) => undefined,
    removeHeader: (_name: string) => undefined,
    writeHead: (status: number) => { statusCode = status; },
    end: (chunk?: unknown) => {
      if (chunk !== undefined) body += String(chunk);
    },
  } as unknown as http.ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

const makeConfig = (overrides: Record<string, unknown> = {}): EnvCPConfig =>
  EnvCPConfigSchema.parse({
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
      ...overrides,
    },
    encryption: { enabled: false },
    storage: { encrypted: false, path: '.envcp/store.json' },
    sync: { enabled: false },
  });

// ---------------------------------------------------------------------------
// GeminiAdapter: getGeminiFunctionDeclarations with a tool that has no
// `properties` key — covers the `|| {}` branch on gemini.ts line 25.
// ---------------------------------------------------------------------------
describe('GeminiAdapter.getGeminiFunctionDeclarations — empty properties branch', () => {
  class TestGemini extends GeminiAdapter {
    protected registerTools(): void {
      // Tool with parameters object but no `properties` key
      (this as any).tools.set('no_props_tool', {
        name: 'no_props_tool',
        description: 'test tool with no properties',
        parameters: {},  // no 'properties' key → triggers || {}
        handler: async () => ({}),
      } as ToolDefinition);
    }
  }

  it('uses empty object {} when tool parameters has no properties key', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-props-'));
    try {
      const adapter = new TestGemini(makeConfig(), tmpDir);
      const declarations = adapter.getGeminiFunctionDeclarations();
      const noProps = declarations.find(d => d.name === 'no_props_tool');
      expect(noProps).toBeDefined();
      expect(noProps!.parameters.properties).toEqual({});  // fell back to {}
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// OpenAIAdapter: getOpenAIFunctions with a tool that has no `properties` key
// — covers the `|| {}` branch on openai.ts line 25.
// ---------------------------------------------------------------------------
describe('OpenAIAdapter.getOpenAIFunctions — empty properties branch', () => {
  class TestOpenAI extends OpenAIAdapter {
    protected registerTools(): void {
      (this as any).tools.set('no_props_tool', {
        name: 'no_props_tool',
        description: 'test',
        parameters: {},
        handler: async () => ({}),
      } as ToolDefinition);
    }
  }

  it('uses empty object {} when tool parameters has no properties key', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-openai-props-'));
    try {
      const adapter = new TestOpenAI(makeConfig(), tmpDir);
      const functions = adapter.getOpenAIFunctions();
      const fn = functions.find(f => f.name === 'no_props_tool');
      expect(fn).toBeDefined();
      expect(fn!.parameters.properties).toEqual({});
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// GeminiAdapter HTTP server: API key auth failure
// Covers gemini.ts lines 82-84 (log + sendJson 401 + return).
// ---------------------------------------------------------------------------
describe('GeminiAdapter HTTP server — API key auth failure', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-auth-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'secret-key');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 401 when x-goog-api-key header is wrong (line 80 truthy branch + 82-84 block)', async () => {
    const { status } = await fetchHttp(
      port, 'GET', '/v1/models', undefined,
      { 'X-Goog-Api-Key': 'wrong-key' },
    );
    expect(status).toBe(401);
  });

  it('returns 401 when authorization header is wrong', async () => {
    const { status } = await fetchHttp(
      port, 'GET', '/v1/models', undefined,
      { Authorization: 'Bearer wrong-key' },
    );
    expect(status).toBe(401);
  });

  it('accepts request with correct x-goog-api-key', async () => {
    const { status } = await fetchHttp(
      port, 'GET', '/v1/models', undefined,
      { 'X-Goog-Api-Key': 'secret-key' },
    );
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GeminiAdapter HTTP server: /v1/functions/call — args || {} branch
// Covers gemini.ts line 127.
// ---------------------------------------------------------------------------
describe('GeminiAdapter HTTP server — /v1/functions/call without args', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-args-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses {} when args field is absent in POST /v1/functions/call (line 127 branch)', async () => {
    // Body has `name` but no `args` → triggers `args || {}`
    const { status, data } = await fetchHttp(
      port, 'POST', '/v1/functions/call',
      { name: 'envcp_list' },  // no args
    );
    // callTool with {} args — might fail on session but that's ok, we just need args || {}
    expect(status).not.toBe(500);  // server handled it (not a crash)
  });
});

// ---------------------------------------------------------------------------
// GeminiAdapter HTTP server: generateContent with no contents and with
// contents-but-no-parts. Covers gemini.ts lines 159-161.
// ---------------------------------------------------------------------------
describe('GeminiAdapter HTTP server — generateContent branch coverage', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-content-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns available tools when contents is absent (line 159 FALSE branch)', async () => {
    // No `contents` field → `if (contents)` is false → skip function call extraction
    const { status, data } = await fetchHttp(
      port, 'POST', '/v1/models/envcp:generateContent',
      {},  // no contents
    );
    expect(status).toBe(200);
    expect((data as any).candidates).toBeDefined();
    expect((data as any).availableTools).toBeDefined();
  });

  it('handles content items with no parts field (line 161 || [] branch)', async () => {
    // contents array present, but items have no `parts` → `content.parts || []` uses []
    const { status, data } = await fetchHttp(
      port, 'POST', '/v1/models/envcp:generateContent',
      { contents: [{}] },  // content item has no `parts`
    );
    expect(status).toBe(200);
    // No function calls found → returns available tools
    expect((data as any).candidates).toBeDefined();
  });
});



// ---------------------------------------------------------------------------
// OpenAIAdapter HTTP server: API key auth failure
// Covers openai.ts lines 85-87.
// ---------------------------------------------------------------------------
describe('OpenAIAdapter HTTP server — API key auth failure', () => {
  let tmpDir: string;
  let adapter: OpenAIAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-openai-auth-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'openai-secret');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 401 when authorization header is wrong (lines 85-87)', async () => {
    const { status } = await fetchHttp(
      port, 'GET', '/v1/models', undefined,
      { Authorization: 'Bearer wrong-key' },
    );
    expect(status).toBe(401);
  });

  it('accepts request with correct bearer token', async () => {
    const { status } = await fetchHttp(
      port, 'GET', '/v1/models', undefined,
      { Authorization: 'Bearer openai-secret' },
    );
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// RESTAdapter HTTP server: API key auth failure
// Covers rest.ts lines 127-129.
// ---------------------------------------------------------------------------
describe('RESTAdapter HTTP server — API key auth failure', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-auth-'));
    adapter = new RESTAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'rest-secret');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 401 when x-api-key is wrong (lines 127-129)', async () => {
    const { status } = await fetchHttp(
      port, 'GET', '/api/health', undefined,
      { 'X-Api-Key': 'wrong' },
    );
    expect(status).toBe(401);
  });

  it('returns 401 when authorization bearer is wrong', async () => {
    const { status } = await fetchHttp(
      port, 'GET', '/api/health', undefined,
      { Authorization: 'Bearer wrong' },
    );
    expect(status).toBe(401);
  });

  it('accepts request with correct x-api-key', async () => {
    const { status } = await fetchHttp(
      port, 'GET', '/api/health', undefined,
      { 'X-Api-Key': 'rest-secret' },
    );
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// RESTAdapter: "locked" error → status 401 (rest.ts line 250 branch)
// Uses encrypted storage with no session → ensurePassword() throws 'Session locked'.
// ---------------------------------------------------------------------------
describe('RESTAdapter HTTP server — locked error returns 401', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-locked-'));
    // Encrypted mode: no password set, so ensurePassword() will throw "Session locked"
    const cfg = EnvCPConfigSchema.parse({
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
      encryption: { enabled: true },
      storage: { encrypted: true, path: '.envcp/store.enc' },
      sync: { enabled: false },
    });
    adapter = new RESTAdapter(cfg, tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 401 when vault is locked (line 250 locked branch)', async () => {
    // GET /api/variables → callTool → ensurePassword() → throws 'Session locked'
    const { status, data } = await fetchHttp(port, 'GET', '/api/variables');
    expect(status).toBe(401);
    expect((data as any).error).toMatch(/locked/i);
  });
});

// ---------------------------------------------------------------------------
// RESTAdapter: "disabled" error → status 403 (rest.ts line 250 disabled branch)
// ---------------------------------------------------------------------------
describe('RESTAdapter HTTP server — disabled error returns 403', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-disabled-'));
    // allow_ai_read = false → "AI read access is disabled"
    const cfg = makeConfig({ allow_ai_read: false });
    adapter = new RESTAdapter(cfg, tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterAll(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 403 when AI read is disabled (line 250 disabled branch)', async () => {
    const { status, data } = await fetchHttp(port, 'GET', '/api/variables');
    expect(status).toBe(403);
    expect((data as any).error).toMatch(/disabled/i);
  });
});

describe('Adapter auth and URL fallback branches', () => {
  it('OpenAI: uses unknown remoteAddress fallback during auth failure', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-fallback-'));
    const adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'openai-secret');

    try {
      const req = {
        method: 'GET',
        url: '/v1/models',
        headers: { authorization: 'Bearer wrong' },
        socket: { remoteAddress: undefined },
      } as unknown as http.IncomingMessage;
      const mock = makeMockResponse();

      await (adapter as any).server.listeners('request')[0](req, mock.res);

      expect(mock.getStatus()).toBe(401);
      expect(mock.getBody()).toContain('Invalid API key');
    } finally {
      adapter.stopServer();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('OpenAI: falls back when req.url and host are missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oai-urlhost-'));
    const adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'openai-secret');

    try {
      const req = {
        method: 'GET',
        url: undefined,
        headers: { authorization: 'Bearer openai-secret' },
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as http.IncomingMessage;
      const mock = makeMockResponse();

      await (adapter as any).server.listeners('request')[0](req, mock.res);

      expect(mock.getStatus()).toBe(200);
    } finally {
      adapter.stopServer();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('Gemini: uses unknown remoteAddress fallback during auth failure', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gem-fallback-'));
    const adapter = new GeminiAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'gem-secret');

    try {
      const req = {
        method: 'GET',
        url: '/v1/models',
        headers: { 'x-goog-api-key': 'wrong' },
        socket: { remoteAddress: undefined },
      } as unknown as http.IncomingMessage;
      const mock = makeMockResponse();

      await (adapter as any).server.listeners('request')[0](req, mock.res);

      expect(mock.getStatus()).toBe(401);
      expect(mock.getBody()).toContain('Invalid API key');
    } finally {
      adapter.stopServer();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('Gemini: falls back when req.url and host are missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gem-urlhost-'));
    const adapter = new GeminiAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'gem-secret');

    try {
      const req = {
        method: 'GET',
        url: undefined,
        headers: { 'x-goog-api-key': 'gem-secret' },
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as http.IncomingMessage;
      const mock = makeMockResponse();

      await (adapter as any).server.listeners('request')[0](req, mock.res);

      expect(mock.getStatus()).toBe(200);
    } finally {
      adapter.stopServer();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('REST: uses unknown remoteAddress fallback during auth failure', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-fallback-'));
    const adapter = new RESTAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'rest-secret');

    try {
      const req = {
        method: 'GET',
        url: '/api/health',
        headers: { 'x-api-key': 'wrong' },
        socket: { remoteAddress: undefined },
      } as unknown as http.IncomingMessage;
      const mock = makeMockResponse();

      await (adapter as any).server.listeners('request')[0](req, mock.res);

      expect(mock.getStatus()).toBe(401);
      expect(mock.getBody()).toContain('Invalid API key');
    } finally {
      adapter.stopServer();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('REST: falls back when req.url and host are missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-urlhost-'));
    const adapter = new RESTAdapter(makeConfig(), tmpDir);
    const port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'rest-secret');

    try {
      const req = {
        method: 'GET',
        url: undefined,
        headers: { 'x-api-key': 'rest-secret' },
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as http.IncomingMessage;
      const mock = makeMockResponse();

      await (adapter as any).server.listeners('request')[0](req, mock.res);

      expect(mock.getStatus()).toBe(404);
    } finally {
      adapter.stopServer();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
