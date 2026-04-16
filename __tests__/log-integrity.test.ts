import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { LogManager } from '../src/storage/index.js';
import { AuditConfig, AuditConfigSchema } from '../src/types.js';

const defaultFields = {
  session_id: true,
  client_id: true,
  client_type: true,
  ip: true,
  user_agent: false,
  purpose: false,
  duration_ms: true,
  variable: true,
  message: true,
};

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return AuditConfigSchema.parse({
    enabled: true,
    retain_days: 30,
    fields: defaultFields,
    hmac: false,
    hmac_key_path: '.envcp/.audit-hmac-key',
    hmac_chain: false,
    protection: 'none',
    ...overrides,
  });
}

describe('LogManager HMAC Chain (Issue #177)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-chain-test-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('chained HMAC', () => {
    it('adds prev_hmac and chain_index when hmac_chain enabled', async () => {
      const config = makeConfig({
        hmac: true,
        hmac_chain: true,
        hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
      });

      const logs = new LogManager(logDir, config);
      await logs.init();

      const entry = {
        timestamp: new Date().toISOString(),
        operation: 'get' as const,
        source: 'cli' as const,
        success: true,
      };

      await logs.log(entry);
      await logs.log({ ...entry, timestamp: new Date().toISOString() });

      const entries = await logs.getLogs({});
      expect(entries.length).toBe(2);

      expect(entries[0].prev_hmac).toBeUndefined();
      expect(entries[0].chain_index).toBe(0);

      expect(entries[1].prev_hmac).toBe(entries[0].hmac);
      expect(entries[1].chain_index).toBe(1);
    });

    it('verifyLogChain returns valid for unmodified chain', async () => {
      const config = makeConfig({
        hmac: true,
        hmac_chain: true,
        hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
      });

      const logs = new LogManager(logDir, config);
      await logs.init();

      for (let i = 0; i < 5; i++) {
        await logs.log({
          timestamp: new Date().toISOString(),
          operation: 'get',
          source: 'cli',
          success: true,
        });
      }

      const result = await logs.verifyLogChain();
      expect(result.valid).toBe(true);
      expect(result.entries).toBe(5);
      expect(result.tampered).toHaveLength(0);
    });

    it('verifyLogChain detects tampered entries', async () => {
      const config = makeConfig({
        hmac: true,
        hmac_chain: true,
        hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
      });

      const logs = new LogManager(logDir, config);
      await logs.init();

      for (let i = 0; i < 3; i++) {
        await logs.log({
          timestamp: new Date().toISOString(),
          operation: 'get',
          source: 'cli',
          success: true,
        });
      }

      const logFile = path.join(logDir, `operations-${new Date().toISOString().split('T')[0]}.log`);
      const content = await fs.readFile(logFile, 'utf8');
      const lines = content.trim().split('\n');
      const tamperedLine = JSON.parse(lines[1]);
      tamperedLine.success = false;
      lines[1] = JSON.stringify(tamperedLine);
      await fs.writeFile(logFile, lines.join('\n') + '\n');

      const result = await logs.verifyLogChain();
      expect(result.valid).toBe(false);
      expect(result.tampered).toContain(1);
    });
  });

  describe('simple HMAC (no chain)', () => {
    it('signs entries without prev_hmac when hmac_chain disabled', async () => {
      const config = makeConfig({
        hmac: true,
        hmac_chain: false,
        hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
      });

      const logs = new LogManager(logDir, config);
      await logs.init();

      await logs.log({
        timestamp: new Date().toISOString(),
        operation: 'get',
        source: 'cli',
        success: true,
      });

      const entries = await logs.getLogs({});
      expect(entries[0].hmac).toBeDefined();
      expect(entries[0].prev_hmac).toBeUndefined();
      expect(entries[0].chain_index).toBeUndefined();
    });
  });
});

describe('LogManager Log Protection (Issue #179)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-protect-test-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('protection configuration', () => {
    it('accepts protection mode in config', async () => {
      const config = makeConfig({ protection: 'append_only' });

      const logs = new LogManager(logDir, config);
      await logs.init();
      expect(logs).toBeDefined();
    });

    it('accepts immutable protection mode', async () => {
      const config = makeConfig({ protection: 'immutable' });

      const logs = new LogManager(logDir, config);
      await logs.init();
      expect(logs).toBeDefined();
    });
  });

  describe('chattr operations', () => {
    it('setAppendOnly returns false on non-Linux', async () => {
      if (process.platform === 'linux') {
        return;
      }

      const config = makeConfig({ protection: 'append_only' });

      const logs = new LogManager(logDir, config);
      await logs.init();

      const result = await logs.setAppendOnly(path.join(logDir, 'test.log'));
      expect(result).toBe(false);
    });

    it('setImmutable returns false on non-Linux', async () => {
      if (process.platform === 'linux') {
        return;
      }

      const config = makeConfig({ protection: 'immutable' });

      const logs = new LogManager(logDir, config);
      await logs.init();

      const result = await logs.setImmutable(path.join(logDir, 'test.log'));
      expect(result).toBe(false);
    });
  });

  describe('protectLogFiles', () => {
    it('returns empty results when protection is none', async () => {
      const config = makeConfig({ protection: 'none' });

      const logs = new LogManager(logDir, config);
      await logs.init();

      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(path.join(logDir, 'operations-2026-01-01.log'), '{}\n');

      const result = await logs.protectLogFiles();
      expect(result.protected).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });
});
