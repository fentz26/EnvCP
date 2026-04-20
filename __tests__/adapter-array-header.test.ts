import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import { OpenAIAdapter } from '../src/adapters/openai.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';
import { EnvCPConfigSchema, EnvCPConfig } from '../src/types.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function makeConfig(): EnvCPConfig {
  return EnvCPConfigSchema.parse({
    access: {
      allow_ai_read: true, allow_ai_write: true, allow_ai_delete: true,
      allow_ai_export: true, allow_ai_execute: true, allow_ai_active_check: true,
      require_user_reference: false, require_confirmation: false,
      mask_values: false, blacklist_patterns: [],
    },
    encryption: { enabled: false },
    storage: { encrypted: false, path: '.envcp/store.json' },
    sync: { enabled: false },
  });
}

function fetchWithArrayHeader(
  port: number, urlPath: string, clientIds: string[],
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: urlPath, method: 'GET',
        headers: { 'x-envcp-client-id': clientIds },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode!, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode!, data }); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('OpenAI adapter — array x-envcp-client-id header (line 96 branch)', () => {
  let tmpDir: string;
  let adapter: OpenAIAdapter;
  let port: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-oa-arr-'));
    adapter = new OpenAIAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterEach(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 10));
  });

  it('takes first element when x-envcp-client-id is an array', async () => {
    const { status } = await fetchWithArrayHeader(port, '/v1/models', ['client1', 'client2']);
    expect(status).toBe(200);
  });
});

describe('Gemini adapter — array x-envcp-client-id header (line 93 branch)', () => {
  let tmpDir: string;
  let adapter: GeminiAdapter;
  let port: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-ga-arr-'));
    adapter = new GeminiAdapter(makeConfig(), tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1');
  });

  afterEach(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 10));
  });

  it('takes first element when x-envcp-client-id is an array', async () => {
    const { status } = await fetchWithArrayHeader(port, '/v1/models', ['client1', 'client2']);
    expect(status).toBe(200);
  });
});
