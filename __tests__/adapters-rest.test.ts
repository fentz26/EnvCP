import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { RESTAdapter } from '../src/adapters/rest';
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

type ApiResponse = { success: boolean; data?: unknown; error?: string; timestamp: string };

describe('RESTAdapter HTTP server', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  const getJson = (urlPath: string, headers?: Record<string, string>): Promise<{ status: number; body: ApiResponse }> =>
    new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as ApiResponse });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { success: false, timestamp: '' } });
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

  const methodJson = (
    method: string,
    urlPath: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: ApiResponse }> =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify(payload ?? {});
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
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
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as ApiResponse });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { success: false, timestamp: '' } });
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-test-'));
    adapter = new RESTAdapter(makeConfig(), tmpDir);
    port = 49600 + Math.floor(Math.random() * 200);
    await adapter.startServer(port, '127.0.0.1');
  });

  afterEach(async () => {
    adapter.stopServer();
    await fs.remove(tmpDir);
  });

  describe('health endpoints', () => {
    it('GET /api/health returns ok', async () => {
      const { status, body } = await getJson('/api/health');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect((body.data as { status: string }).status).toBe('ok');
    });

    it('GET /api returns ok', async () => {
      const { status, body } = await getJson('/api');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 for unknown path', async () => {
      const { status, body } = await getJson('/unknown');
      expect(status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('tools endpoint', () => {
    it('GET /api/tools returns list of tools', async () => {
      const { status, body } = await getJson('/api/tools');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const data = body.data as { tools: Array<{ name: string }> };
      expect(Array.isArray(data.tools)).toBe(true);
      expect(data.tools.length).toBeGreaterThan(0);
    });

    it('POST /api/tools/:name calls a tool', async () => {
      const { status, body } = await methodJson('POST', '/api/tools/envcp_list');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('variables CRUD', () => {
    it('POST /api/variables creates a variable', async () => {
      const { status, body } = await methodJson('POST', '/api/variables', {
        name: 'REST_VAR',
        value: 'rest_value',
      });
      expect(status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('GET /api/variables lists all variables', async () => {
      await methodJson('POST', '/api/variables', { name: 'LIST_VAR', value: 'v1' });

      const { status, body } = await getJson('/api/variables');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const data = body.data as { variables: string[] };
      expect(data.variables).toContain('LIST_VAR');
    });

    it('GET /api/variables/:name returns a variable', async () => {
      await methodJson('POST', '/api/variables', { name: 'NAMED_VAR', value: 'named_val' });

      const { status, body } = await getJson('/api/variables/NAMED_VAR');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const data = body.data as { name: string };
      expect(data.name).toBe('NAMED_VAR');
    });

    it('PUT /api/variables/:name updates a variable', async () => {
      await methodJson('POST', '/api/variables', { name: 'UPD_VAR', value: 'old_val' });

      const { status, body } = await methodJson('PUT', '/api/variables/UPD_VAR', { value: 'new_val' });
      expect(status).toBe(200);
      expect(body.success).toBe(true);

      const { body: getBody } = await getJson('/api/variables/UPD_VAR?show_value=true');
      const data = getBody.data as { value: string };
      expect(data.value).toBe('new_val');
    });

    it('DELETE /api/variables/:name deletes a variable', async () => {
      await methodJson('POST', '/api/variables', { name: 'DEL_VAR', value: 'bye' });

      const { status, body } = await methodJson('DELETE', '/api/variables/DEL_VAR');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 when getting a non-existent variable', async () => {
      const { status, body } = await getJson('/api/variables/DOES_NOT_EXIST');
      expect(status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('access endpoint', () => {
    it('GET /api/access/:name returns access info for existing variable', async () => {
      await methodJson('POST', '/api/variables', { name: 'ACCESS_VAR', value: 'v' });

      const { status, body } = await getJson('/api/access/ACCESS_VAR');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('API key authentication', () => {
    let secPort: number;
    let secAdapter: RESTAdapter;

    beforeEach(async () => {
      secPort = port + 300;
      secAdapter = new RESTAdapter(makeConfig(), tmpDir);
      await secAdapter.startServer(secPort, '127.0.0.1', 'test-api-key');
    });

    afterEach(() => {
      secAdapter.stopServer();
    });

    it('rejects requests without API key', async () => {
      const { status, body } = await getJson(`http://127.0.0.1:${secPort}/api/health`.replace('http://127.0.0.1:', '') );
      // Use direct HTTP request to secure port
      const result = await new Promise<{ status: number; body: ApiResponse }>((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: secPort, path: '/api/health' }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as ApiResponse }));
        });
        req.on('error', reject);
        req.end();
      });
      expect(result.status).toBe(401);
      expect(result.body.success).toBe(false);
    });

    it('accepts requests with correct X-API-Key header', async () => {
      const result = await new Promise<{ status: number; body: ApiResponse }>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: secPort, path: '/api/health', headers: { 'x-api-key': 'test-api-key' } },
          (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as ApiResponse }));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(result.status).toBe(200);
    });

    it('accepts requests with Bearer token', async () => {
      const result = await new Promise<{ status: number; body: ApiResponse }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: secPort,
            path: '/api/health',
            headers: { 'authorization': 'Bearer test-api-key' },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as ApiResponse }));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(result.status).toBe(200);
    });
  });

  describe('getApiDocs', () => {
    it('returns a non-empty API docs string', () => {
      const docs = adapter.getApiDocs();
      expect(typeof docs).toBe('string');
      expect(docs.length).toBeGreaterThan(0);
      expect(docs).toContain('/api/variables');
    });
  });

  describe('OPTIONS preflight', () => {
    it('responds to OPTIONS with 204', () =>
      new Promise<void>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/api/variables', method: 'OPTIONS' },
          (res) => {
            expect(res.statusCode).toBe(204);
            resolve();
          },
        );
        req.on('error', reject);
        req.end();
      }));
  });
});
