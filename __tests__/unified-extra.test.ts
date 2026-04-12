import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { EventEmitter } from 'events';

// Mock EnvCPServer for the MCP mode test
const mockMcpStart = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule('../src/mcp/server', () => ({
  EnvCPServer: jest.fn().mockImplementation(() => ({
    start: mockMcpStart,
  })),
}));

const { UnifiedServer } = await import('../src/server/unified');
const { EnvCPConfigSchema } = await import('../src/types');
import type { ServerConfig } from '../src/types';

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

describe('UnifiedServer MCP mode start', () => {
  let tmpDir: string;

  beforeEach(async () => {
    mockMcpStart.mockClear();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-mcpmode-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates EnvCPServer and calls start() in MCP mode', async () => {
    const serverConfig: ServerConfig = {
      mode: 'mcp',
      port: 0,
      host: '127.0.0.1',
      cors: false,
      auto_detect: false,
    };
    const server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();

    expect(mockMcpStart).toHaveBeenCalledTimes(1);
  });
});

function fetchHttp(port: number, method: string, urlPath: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: unknown }> {
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

describe('UnifiedServer SIGTERM handler', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sigterm-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('calls stop() and process.exit(0) on SIGTERM', async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const serverConfig: ServerConfig = {
      mode: 'all',
      port,
      host: '127.0.0.1',
      cors: true,
      auto_detect: true,
    };
    const server = new UnifiedServer(makeConfig(), serverConfig, tmpDir);
    await server.start();

    // Mock process.exit to prevent actually exiting
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Spy on stop
    const stopSpy = jest.spyOn(server, 'stop');

    // Emit SIGTERM
    process.emit('SIGTERM');

    expect(stopSpy).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);

    mockExit.mockRestore();
    stopSpy.mockRestore();
    // Server already stopped by the handler
  });
});

describe('UnifiedServer handleGeminiRequest /v1/functions/call', () => {
  let tmpDir: string;
  let server: UnifiedServer;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-gemini-fc-'));
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

  it('routes /v1/functions/call to Gemini handler via direct call', async () => {
    // The normal routing sends /v1/functions/call to OpenAI (line 187 matches first).
    // To cover lines 412-415 in handleGeminiRequest, call it directly.
    const handleGemini = (server as any).handleGeminiRequest.bind(server);

    // Create a mock request for /v1/functions/call POST
    const reqBody = JSON.stringify({ name: 'envcp_list', args: {} });
    const mockReq = new EventEmitter() as any;
    mockReq.url = '/v1/functions/call';
    mockReq.method = 'POST';
    mockReq.headers = { host: 'localhost', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(reqBody)) };

    // Create a mock response
    const chunks: Buffer[] = [];
    const mockRes = {
      writeHead: jest.fn(),
      end: jest.fn((data: any) => { if (data) chunks.push(Buffer.from(data)); }),
      setHeader: jest.fn(),
      getHeader: jest.fn(),
    } as any;

    // Feed the body to the request
    const resultPromise = handleGemini(mockReq, mockRes);
    process.nextTick(() => {
      mockReq.emit('data', Buffer.from(reqBody));
      mockReq.emit('end');
    });

    await resultPromise;

    // Verify the response was sent via sendJson → res.end()
    expect(mockRes.end).toHaveBeenCalled();
    const responseData = JSON.parse(chunks[0].toString());
    expect(responseData.name).toBe('envcp_list');
    expect(responseData.response).toBeDefined();
    expect(responseData.response.result).toBeDefined();
  });
});
