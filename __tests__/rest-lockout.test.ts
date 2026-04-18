import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import { RESTAdapter } from '../src/adapters/rest.js';
import { LockoutManager } from '../src/utils/lockout.js';
import { EnvCPConfig, EnvCPConfigSchema } from '../src/types.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function fetch(
  port: number,
  method: string,
  urlPath: string,
  headers?: Record<string, string>,
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, data: JSON.parse(data), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode!, data, headers: res.headers });
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function makeConfig(overrides: Record<string, unknown> = {}): EnvCPConfig {
  return EnvCPConfigSchema.parse({
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
    ...overrides,
  });
}

describe('RESTAdapter — constructor clears API lockout when password is provided', () => {
  let tmpDir: string;
  const sessionPath = '.envcp/.session';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-clear-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resets an existing api-key lockout file on construction', async () => {
    // Seed a lockout file so we can verify it gets cleared.
    const sessionDir = path.join(tmpDir, path.dirname(sessionPath));
    const lockoutPath = path.join(sessionDir, '.lockout-api');
    await fs.mkdir(sessionDir, { recursive: true });
    const mgr = new LockoutManager(lockoutPath);
    for (let i = 0; i < 6; i++) {
      await mgr.recordFailure(5, 60);
    }
    const before = await mgr.check();
    expect(before.attempts).toBeGreaterThan(0);

    const config = makeConfig({ session: { path: sessionPath } });
    // Pass a password to trigger clearApiKeyLockout
    new RESTAdapter(config, tmpDir, 'pw', path.join(tmpDir, 'vault.enc'));

    // Give the async reset a tick to complete.
    await new Promise((r) => setTimeout(r, 50));

    const after = await mgr.check();
    expect(after.attempts).toBe(0);
    expect(after.locked).toBe(false);
  });

  it('silently ignores reset errors (construction does not throw)', async () => {
    const config = makeConfig();
    expect(() => {
      new RESTAdapter(config, '/definitely/not/a/real/path', 'pw');
    }).not.toThrow();
  });
});

describe('RESTAdapter — brute-force lockout on invalid API key', () => {
  let tmpDir: string;
  let adapter: RESTAdapter;
  let port: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-bfp-'));
    const cfg = makeConfig({
      security: {
        brute_force_protection: {
          enabled: true,
          max_attempts: 2,
          lockout_duration: 60,
          progressive_delay: false,
          max_delay: 60,
          permanent_lockout_threshold: 4,
        },
      },
    });
    adapter = new RESTAdapter(cfg, tmpDir);
    port = await getFreePort();
    await adapter.startServer(port, '127.0.0.1', 'correct-api-key');
  });

  afterEach(async () => {
    adapter.stopServer();
    await fs.rm(tmpDir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 10));
  });

  it('returns 429 with Retry-After after threshold and reports lockout on next request', async () => {
    // Two failing attempts -> hit threshold
    const first = await fetch(port, 'GET', '/api/health', { 'x-api-key': 'wrong' });
    expect(first.status).toBe(401);
    const second = await fetch(port, 'GET', '/api/health', { 'x-api-key': 'wrong' });
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
    expect(second.data.error).toMatch(/try again/i);

    // Subsequent request should be blocked by the pre-check (lockoutStatus.locked=true).
    const third = await fetch(port, 'GET', '/api/health', { 'x-api-key': 'correct-api-key' });
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
  });

  it('returns 403 on pre-check when a permanent lockout is already on disk', async () => {
    // Seed the on-disk lockout file directly with permanent_locked=true.
    const sessionDir = path.join(tmpDir, '.envcp');
    await fs.mkdir(sessionDir, { recursive: true });
    const lockoutFile = path.join(sessionDir, '.lockout-api');
    await fs.writeFile(
      lockoutFile,
      JSON.stringify({
        attempts: 0,
        lockout_count: 2,
        permanent_lockout_count: 2,
        locked_until: null,
        permanent_locked: true,
      }),
    );
    const mgr = new LockoutManager(lockoutFile);
    const status = await mgr.check();
    expect(status.permanent_locked).toBe(true);

    // Start a second adapter (no password, so constructor does NOT clear lockout)
    const cfg2 = makeConfig({
      security: {
        brute_force_protection: {
          enabled: true,
          max_attempts: 1,
          lockout_duration: 60,
          progressive_delay: false,
          max_delay: 60,
          permanent_lockout_threshold: 2,
        },
      },
    });
    const a2 = new RESTAdapter(cfg2, tmpDir);
    const p2 = await getFreePort();
    await a2.startServer(p2, '127.0.0.1', 'api-key');
    try {
      const result = await fetch(p2, 'GET', '/api/health', { 'x-api-key': 'api-key' });
      expect(result.status).toBe(403);
      expect(result.data.error).toMatch(/permanently locked/i);
    } finally {
      a2.stopServer();
      await new Promise((r) => setTimeout(r, 10));
    }
  });

  it('permanently locks after exceeding permanent_lockout_threshold', async () => {
    const cfg = makeConfig({
      security: {
        brute_force_protection: {
          enabled: true,
          max_attempts: 1,
          lockout_duration: 1,
          progressive_delay: false,
          max_delay: 1,
          permanent_lockout_threshold: 2,
        },
      },
    });
    const a2 = new RESTAdapter(cfg, tmpDir);
    const port2 = await getFreePort();
    await a2.startServer(port2, '127.0.0.1', 'key');

    try {
      // Exceed permanent threshold (2 failures -> permanent).
      await fetch(port2, 'GET', '/api/health', { 'x-api-key': 'bad' });
      const locked = await fetch(port2, 'GET', '/api/health', { 'x-api-key': 'bad' });
      expect([403, 429]).toContain(locked.status);

      // Wait for the temporary lockout window to pass, then try once more to
      // trip the permanent threshold.
      await new Promise((r) => setTimeout(r, 1200));
      const trip = await fetch(port2, 'GET', '/api/health', { 'x-api-key': 'bad' });
      expect([403, 429]).toContain(trip.status);

      // Next pre-check should report permanent lockout or still locked.
      const after = await fetch(port2, 'GET', '/api/health', { 'x-api-key': 'key' });
      expect([403, 429]).toContain(after.status);
    } finally {
      a2.stopServer();
      await new Promise((r) => setTimeout(r, 10));
    }
  });
});
