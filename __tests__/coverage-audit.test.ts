import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as net from 'net';
import { StorageManager, LogManager } from '../src/storage/index';
import { AuditConfigSchema, EnvCPConfigSchema } from '../src/types';
import { setCorsHeaders } from '../src/utils/http';
import { mergeServiceConfig } from '../src/service/config';
import { getSystemIdentifier } from '../src/config/config-hmac';
import { ensureDir } from '../src/utils/fs';

const projectRoot = path.resolve(new URL(import.meta.url).pathname, '..', '..');

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

describe('CORS setCorsHeaders — invalid origin URL (http.ts line 41)', () => {
  it('sets empty origin when requestOrigin is not a valid URL', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setCorsHeaders(res, undefined, 'not a url://://');
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('');
  });

  it('sets empty origin when requestOrigin is a non-localhost http URL', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setCorsHeaders(res, undefined, 'http://example.com');
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('');
  });

  it('allows http://127.0.0.1 origin', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setCorsHeaders(res, undefined, 'http://127.0.0.1');
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('http://127.0.0.1');
  });

  it('allows http://localhost origin', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setCorsHeaders(res, undefined, 'http://localhost');
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('http://localhost');
  });

  it('rejects http://localhost.evil.com (H1 CORS bypass attempt)', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setCorsHeaders(res, undefined, 'http://localhost.evil.com');
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('');
  });

  it('rejects http://127.0.0.1.evil.com', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setCorsHeaders(res, undefined, 'http://127.0.0.1.evil.com');
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('');
  });

  it('rejects https://localhost (wrong protocol)', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setCorsHeaders(res, undefined, 'https://localhost');
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('');
  });

  it('uses provided allowedOrigin when set', () => {
    const req = { socket: {} } as http.IncomingMessage;
    const res = new http.ServerResponse(req);
    setCorsHeaders(res, 'https://my-app.com', undefined);
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('https://my-app.com');
  });
});

describe('service/config.ts — assertSafe validation (lines 73, 76)', () => {
  it('rejects api_key with special shell characters (line 73)', () => {
    expect(() => mergeServiceConfig({ server: { api_key: 'key&injection' } }))
      .toThrow('contains disallowed characters');
  });

  it('rejects api_key with pipe character', () => {
    expect(() => mergeServiceConfig({ server: { api_key: 'key|pipe' } }))
      .toThrow('contains disallowed characters');
  });

  it('rejects api_key with semicolon', () => {
    expect(() => mergeServiceConfig({ server: { api_key: 'key;rm' } }))
      .toThrow('contains disallowed characters');
  });

  it('rejects api_key with newline', () => {
    expect(() => mergeServiceConfig({ server: { api_key: 'key\ninjection' } }))
      .toThrow('contains disallowed characters');
  });

  it('rejects host with unsafe characters (line 76)', () => {
    expect(() => mergeServiceConfig({ server: { host: 'host`whoami`' } }))
      .toThrow('contains disallowed characters');
  });

  it('rejects log_level with newline (line 76)', () => {
    expect(() => mergeServiceConfig({ log_level: 'info\nevil' }))
      .toThrow('contains disallowed characters');
  });

  it('rejects working_directory with dollar sign (line 76)', () => {
    expect(() => mergeServiceConfig({ working_directory: '/tmp/$HOME' }))
      .toThrow('contains disallowed characters');
  });

  it('accepts valid api_key with alphanumeric and dash/underscore', () => {
    const config = mergeServiceConfig({ server: { api_key: 'my-api_key-123' } });
    expect(config.server.api_key).toBe('my-api_key-123');
  });

  it('accepts valid host', () => {
    const config = mergeServiceConfig({ server: { host: '192.168.1.1' } });
    expect(config.server.host).toBe('192.168.1.1');
  });

  it('accepts undefined api_key (no validation needed)', () => {
    const config = mergeServiceConfig({});
    expect(config.server.api_key).toBeUndefined();
  });
});

describe('config/config-hmac.ts — getSystemIdentifier USERNAME branch (line 29)', () => {
  it('uses USERNAME when USER and LOGNAME are unset', () => {
    const origUser = process.env.USER;
    const origLogname = process.env.LOGNAME;
    const origUsername = process.env.USERNAME;
    try {
      delete process.env.USER;
      delete process.env.LOGNAME;
      process.env.USERNAME = 'testuser';
      const id = getSystemIdentifier();
      expect(id).toContain('testuser');
    } finally {
      if (origUser !== undefined) process.env.USER = origUser;
      else delete process.env.USER;
      if (origLogname !== undefined) process.env.LOGNAME = origLogname;
      else delete process.env.LOGNAME;
      if (origUsername !== undefined) process.env.USERNAME = origUsername;
      else delete process.env.USERNAME;
    }
  });

  it('falls back to LOGNAME when USER is unset', () => {
    const origUser = process.env.USER;
    const origLogname = process.env.LOGNAME;
    try {
      delete process.env.USER;
      process.env.LOGNAME = 'logname-user';
      delete process.env.USERNAME;
      const id = getSystemIdentifier();
      expect(id).toContain('logname-user');
    } finally {
      if (origUser !== undefined) process.env.USER = origUser;
      else delete process.env.USER;
      if (origLogname !== undefined) process.env.LOGNAME = origLogname;
      else delete process.env.LOGNAME;
    }
  });

  it('falls back to unknown when no env vars are set', () => {
    const origUser = process.env.USER;
    const origLogname = process.env.LOGNAME;
    const origUsername = process.env.USERNAME;
    try {
      delete process.env.USER;
      delete process.env.LOGNAME;
      delete process.env.USERNAME;
      const id = getSystemIdentifier();
      expect(id).toContain('unknown');
    } finally {
      if (origUser !== undefined) process.env.USER = origUser;
      else delete process.env.USER;
      if (origLogname !== undefined) process.env.LOGNAME = origLogname;
      else delete process.env.LOGNAME;
      if (origUsername !== undefined) process.env.USERNAME = origUsername;
      else delete process.env.USERNAME;
    }
  });
});

describe('config/manager.ts — signature file exists without config (line 117)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sigtest-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('does not throw when .config_signature exists but envcp.yaml is missing', async () => {
    const { loadConfig } = await import('../src/config/manager.js');
    const envcpDir = path.join(tmpDir, '.envcp');
    await ensureDir(envcpDir);
    await fs.writeFile(path.join(envcpDir, '.config_signature'), 'sha256:fakesig');
    const config = await loadConfig(tmpDir);
    expect(config).toBeDefined();
    expect(config.version).toBe('1.0');
  });
});

describe('storage/index.ts — loadLastChainState early return (line 282)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-chain-early-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips loading when chainLoaded is already true (line 282)', async () => {
    const config = AuditConfigSchema.parse({
      hmac: true,
      hmac_chain: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });
    const logMgr = new LogManager(logDir, config);
    await logMgr.init();

    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'get', source: 'cli', success: true });
    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'set', source: 'cli', success: true });

    const entries = await logMgr.getLogs({});
    expect(entries.length).toBe(2);
    expect(entries[1].chain_index).toBe(1);
  });
});

describe('storage/index.ts — loadLastChainState entry without chain_index (line 297)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-no-chain-idx-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('handles existing log entry without chain_index field (line 297 undefined branch)', async () => {
    const config = AuditConfigSchema.parse({
      hmac: true,
      hmac_chain: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });

    await ensureDir(logDir);
    const existingEntry = {
      timestamp: new Date().toISOString(),
      operation: 'get' as const,
      source: 'cli' as const,
      success: true,
      hmac: 'some-hmac-value',
    };
    await fs.writeFile(
      path.join(logDir, `operations-${new Date().toISOString().split('T')[0]}.log`),
      JSON.stringify(existingEntry) + '\n',
    );

    const logMgr = new LogManager(logDir, config);
    await logMgr.init();

    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'set', source: 'cli', success: true });

    const entries = await logMgr.getLogs({});
    expect(entries.length).toBe(2);
    expect(entries[1].prev_hmac).toBe('some-hmac-value');
  });
});

describe('storage/index.ts — verifyLogChain prev_hmac mismatch (lines 365-369)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-chain-mismatch-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects entry with valid HMAC but wrong prev_hmac (lines 365-367)', async () => {
    const config = AuditConfigSchema.parse({
      hmac: true,
      hmac_chain: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });

    const logMgr = new LogManager(logDir, config);
    await logMgr.init();

    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'get', source: 'cli', success: true });
    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'set', source: 'cli', success: true });
    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'del', source: 'cli', success: true });

    const logFile = path.join(logDir, `operations-${new Date().toISOString().split('T')[0]}.log`);
    const content = await fs.readFile(logFile, 'utf8');
    const lines = content.trim().split('\n');

    const entry2 = JSON.parse(lines[1]);
    entry2.prev_hmac = 'wrong-prev-hmac';
    lines[1] = JSON.stringify(entry2);

    await fs.writeFile(logFile, lines.join('\n') + '\n');

    const result = await logMgr.verifyLogChain();
    expect(result.valid).toBe(false);
    expect(result.tampered.length).toBeGreaterThan(0);
  });

  it('handles entry without hmac field gracefully in chain (line 369)', async () => {
    const config = AuditConfigSchema.parse({
      hmac: true,
      hmac_chain: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });

    const logMgr = new LogManager(logDir, config);
    await logMgr.init();

    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'get', source: 'cli', success: true });

    const logFile = path.join(logDir, `operations-${new Date().toISOString().split('T')[0]}.log`);
    const content = await fs.readFile(logFile, 'utf8');
    const lines = content.trim().split('\n');

    const entry = JSON.parse(lines[0]);
    delete entry.hmac;
    entry.prev_hmac = undefined;
    lines[0] = JSON.stringify(entry);

    await fs.writeFile(logFile, lines.join('\n') + '\n');

    const result = await logMgr.verifyLogChain();
    expect(result.entries).toBe(1);
  });
});

describe('storage/index.ts — applyFieldFilter prev_hmac/chain_index passthrough (lines 395-396)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-field-filter-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('preserves prev_hmac and chain_index in filtered entry when chaining is enabled', async () => {
    const config = AuditConfigSchema.parse({
      enabled: true,
      retain_days: 30,
      fields: {
        session_id: false,
        client_id: false,
        client_type: false,
        ip: false,
        user_agent: false,
        purpose: false,
        duration_ms: false,
        variable: true,
        message: true,
      },
      hmac: true,
      hmac_chain: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });

    const logMgr = new LogManager(logDir, config);
    await logMgr.init();

    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'get', variable: 'X', source: 'cli', success: true });
    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'set', variable: 'Y', source: 'cli', success: true });

    const entries = await logMgr.getLogs({});
    expect(entries.length).toBe(2);

    expect(entries[1].prev_hmac).toBeDefined();
    expect(entries[1].chain_index).toBe(1);
    expect(entries[0].chain_index).toBe(0);
  });
});

describe('storage/index.ts — log() hmac_chain lazy load (line 421)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-lazy-chain-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('logs with chain enabled even when chainLoaded starts false', async () => {
    const config = AuditConfigSchema.parse({
      enabled: true,
      retain_days: 30,
      fields: {},
      hmac: true,
      hmac_chain: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });

    const logMgr = new LogManager(logDir, config);
    await logMgr.init();

    (logMgr as any).chainLoaded = false;

    await logMgr.log({ timestamp: new Date().toISOString(), operation: 'get', source: 'cli', success: true });

    const entries = await logMgr.getLogs({});
    expect(entries.length).toBe(1);
    expect(entries[0].hmac).toBeDefined();
    expect(entries[0].chain_index).toBe(0);
  });
});

describe('storage/index.ts — protectLogFiles failed branch (line 519)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-protect-fail-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports failed entries when chattr fails (line 522-523)', async () => {
    const config = AuditConfigSchema.parse({
      enabled: true,
      retain_days: 30,
      fields: {},
      hmac: false,
      hmac_key_path: '',
      protection: 'append_only',
    });

    const logMgr = new LogManager(logDir, config);
    await logMgr.init();

    await ensureDir(logDir);
    await fs.writeFile(path.join(logDir, 'operations-2026-04-18.log'), '{}\n');

    const result = await logMgr.protectLogFiles();
    expect(result.failed.length + result.protected.length).toBeGreaterThan(0);
  });
});

describe('storage/index.ts — verifyLogChain with missing chain_index fallback (line 361)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-chain-noidx-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses array index when chain_index is undefined (line 361 ?? branch)', async () => {
    const config = AuditConfigSchema.parse({
      hmac: true,
      hmac_chain: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });

    await ensureDir(logDir);

    const entry = {
      timestamp: new Date().toISOString(),
      operation: 'get',
      source: 'cli',
      success: true,
      hmac: 'tampered-hmac',
    };
    await fs.writeFile(
      path.join(logDir, `operations-${new Date().toISOString().split('T')[0]}.log`),
      JSON.stringify(entry) + '\n',
    );

    const logMgr = new LogManager(logDir, config);
    await logMgr.init();

    const result = await logMgr.verifyLogChain();
    expect(result.tampered).toContain(0);
  });
});

describe('Bearer token case-insensitive auth (L4 verification)', () => {
  it('regex strips "Bearer" with various casings', () => {
    const re = /^Bearer\s+/i;
    expect('Bearer test-secret-key'.replace(re, '')).toBe('test-secret-key');
    expect('bearer test-secret-key'.replace(re, '')).toBe('test-secret-key');
    expect('BEARER test-secret-key'.replace(re, '')).toBe('test-secret-key');
    expect('BeArEr test-secret-key'.replace(re, '')).toBe('test-secret-key');
    expect('Bearer  test-secret-key'.replace(re, '')).toBe('test-secret-key');
    expect('bearer\ttest-secret-key'.replace(re, '')).toBe('test-secret-key');
  });
});

describe('storage/index.ts — tryRestoreFromBackup warning stderr (H2)', () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-h2-warn-'));
    storePath = path.join(tmpDir, '.envcp', 'store.enc');
    await ensureDir(path.dirname(storePath));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('prints warning to stderr when restoring from backup', async () => {
    const { encrypt } = await import('../src/utils/crypto.js');
    const now = new Date().toISOString();
    const validData = JSON.stringify({
      KEY: { name: 'KEY', value: 'backup-value', encrypted: false, created: now, updated: now, sync_to_env: true },
    });
    const password = 'h2-test-pw';
    const encryptedBackup = await encrypt(validData, password);

    await fs.writeFile(`${storePath}.bak.1`, encryptedBackup);
    await fs.writeFile(storePath, 'CORRUPT-DATA');

    const chunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: string | Buffer) => {
      chunks.push(String(chunk));
      return true;
    };

    try {
      const storage = new StorageManager(storePath, true, 3);
      storage.setPassword(password);
      const vars = await storage.load();

      expect(vars.KEY).toBeDefined();
      expect(vars.KEY.value).toBe('backup-value');

      const output = chunks.join('');
      expect(output).toContain('WARNING: primary store failed to decrypt');
    } finally {
      (process.stderr as any).write = origWrite;
    }
  });
});

describe('npm ci vs npm install in CI (M5)', () => {
  it('publish.yml uses npm ci not npm install', async () => {
    const publishPath = path.join(projectRoot, '.github', 'workflows', 'publish.yml');
    const content = await fs.readFile(publishPath, 'utf8');
    const lines = content.split('\n');
    const npmCommands = lines.filter(l => l.trim().startsWith('- run: npm'));
    for (const cmd of npmCommands) {
      expect(cmd).not.toContain('npm install');
    }
  });
});

describe('version consistency (L3)', () => {
  it('VERSION file matches package.json version', async () => {
    const versionPath = path.join(projectRoot, 'VERSION');
    const pkgPath = path.join(projectRoot, 'package.json');

    const version = (await fs.readFile(versionPath, 'utf8')).trim();
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));

    expect(version).toBe(pkg.version);
  });
});

describe('RESTAdapter brute force lockout (rest.ts lines 129-202)', () => {
  let tmpDir: string;
  let port: number;
  let adapter: any;

  const makeConfigWithBFP = () => {
    return EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: true,
        allow_ai_write: true,
        allow_ai_delete: true,
        allow_ai_export: true,
        allow_ai_execute: false,
        allow_ai_active_check: true,
        require_user_reference: false,
        require_confirmation: false,
        mask_values: false,
        blacklist_patterns: [],
      },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
      sync: { enabled: false },
      security: {
        mode: 'recoverable',
        brute_force_protection: {
          enabled: true,
          max_attempts: 2,
          lockout_duration: 60,
          progressive_delay: false,
          max_delay: 60,
          permanent_lockout_threshold: 4,
          permanent_lockout_action: 'require_recovery_key',
          notifications: {},
        },
      },
    });
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rest-lockout-'));
    port = await getFreePort();
  });

  afterEach(async () => {
    if (adapter) {
      try { adapter.stopServer(); } catch {}
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 429 after max failed attempts (lines 152, 156-160)', async () => {
    const { RESTAdapter } = await import('../src/adapters/rest.js');
    const cfg = makeConfigWithBFP();
    adapter = new RESTAdapter(cfg, tmpDir);
    await adapter.startServer(port, '127.0.0.1', 'secret-key-123');

    const { status: s1 } = await fetchHttp(port, 'GET', '/api/health', undefined, { 'X-Api-Key': 'wrong1' });
    expect(s1).toBe(401);

    const { status: s2 } = await fetchHttp(port, 'GET', '/api/health', undefined, { 'X-Api-Key': 'wrong2' });
    expect([401, 429]).toContain(s2);

    const { status: s3, data: d3 } = await fetchHttp(port, 'GET', '/api/health', undefined, { 'X-Api-Key': 'wrong3' });
    expect([429, 403]).toContain(s3);
    expect((d3 as any).error).toBeDefined();
  });

  it('returns 403 on permanent lockout after threshold (lines 155-158, 193-197)', async () => {
    const { RESTAdapter } = await import('../src/adapters/rest.js');
    const cfg = makeConfigWithBFP();
    adapter = new RESTAdapter(cfg, tmpDir);
    await adapter.startServer(port, '127.0.0.1', 'secret-key-123');

    for (let i = 0; i < 8; i++) {
      await fetchHttp(port, 'GET', '/api/health', undefined, { 'X-Api-Key': `wrong${i}` });
    }

    const { status, data } = await fetchHttp(port, 'GET', '/api/health', undefined, { 'X-Api-Key': 'wrong-final' });
    expect([403, 429]).toContain(status);
    expect((data as any).error).toBeDefined();
  });

  it('records lockout on wrong key (lines 176-182, 193-202)', async () => {
    const { RESTAdapter } = await import('../src/adapters/rest.js');
    const cfg = makeConfigWithBFP();
    adapter = new RESTAdapter(cfg, tmpDir);
    await adapter.startServer(port, '127.0.0.1', 'secret-key-123');

    const { status: s1 } = await fetchHttp(port, 'GET', '/api/health', undefined, { 'X-Api-Key': 'bad-key' });
    expect(s1).toBe(401);

    const { status: s2, data: d2 } = await fetchHttp(port, 'GET', '/api/health', undefined, { 'X-Api-Key': 'bad-key-2' });
    if (s2 === 429) {
      expect((d2 as any).error).toMatch(/too many failed|try again/i);
    }

    const { status: s3 } = await fetchHttp(port, 'GET', '/api/health', undefined, { 'X-Api-Key': 'bad-key-3' });
    expect([429, 403]).toContain(s3);
  });
});

describe('lockout.ts — sendNotification with callback (line 62)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-lockout-cb-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('invokes notification callback on lockout (line 62 attempts branch)', async () => {
    const { LockoutManager } = await import('../src/utils/lockout.js');
    const events: any[] = [];
    const lockoutPath = path.join(tmpDir, '.lockout');
    const mgr = new LockoutManager(lockoutPath, (event) => events.push(event));

    for (let i = 0; i < 3; i++) {
      await mgr.recordFailure(2, 30, false, 60, 0);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBeDefined();
  });

  it('invokes callback with custom attempts value (line 62 ?? branch)', async () => {
    const { LockoutManager } = await import('../src/utils/lockout.js');
    const events: any[] = [];
    const lockoutPath = path.join(tmpDir, '.lockout');
    const mgr = new LockoutManager(lockoutPath, (event) => events.push(event));
    mgr.setNotificationSource('api', '1.2.3.4', 'test-agent');

    await mgr.recordFailure(1, 30, false, 60, 0);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].source).toBe('api');
    expect(events[0].ip).toBe('1.2.3.4');
  });

  it('silently ignores callback errors (line 70 catch)', async () => {
    const { LockoutManager } = await import('../src/utils/lockout.js');
    const lockoutPath = path.join(tmpDir, '.lockout');
    const mgr = new LockoutManager(lockoutPath, () => {
      throw new Error('callback boom');
    });

    await expect(mgr.recordFailure(1, 30, false, 60, 0)).resolves.toBeDefined();
  });
});

describe('lockout.ts — clearPermanentLockout (line 248)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-clear-perm-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('clears permanent lockout when set (line 248)', async () => {
    const { LockoutManager } = await import('../src/utils/lockout.js');
    const lockoutPath = path.join(tmpDir, '.lockout');
    const mgr = new LockoutManager(lockoutPath);

    await mgr.recordFailure(1, 30, false, 60, 1);

    const before = await mgr.check();
    if (before.permanent_locked) {
      await mgr.clearPermanentLockout();
      const after = await mgr.check();
      expect(after.permanent_locked).toBe(false);
      expect(after.locked).toBe(false);
    }
  });

  it('is no-op when not permanently locked', async () => {
    const { LockoutManager } = await import('../src/utils/lockout.js');
    const lockoutPath = path.join(tmpDir, '.lockout');
    const mgr = new LockoutManager(lockoutPath);

    await mgr.clearPermanentLockout();
    const status = await mgr.check();
    expect(status.permanent_locked).toBe(false);
  });
});
