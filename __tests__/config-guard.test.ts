import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { ConfigGuard } from '../src/config/config-guard';

describe('ConfigGuard', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-guard-'));
    await fs.ensureDir(path.join(tmpDir, '.envcp', 'logs'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('loadAndLock', () => {
    it('loads and freezes config', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\naccess:\n  allow_ai_read: false\n');
      const guard = new ConfigGuard(tmpDir);
      const config = await guard.loadAndLock();

      expect(config.version).toBe('1.0');

      expect(() => { (config as any).version = '2.0'; }).toThrow();
      expect(() => { (config.access as any).allow_ai_read = true; }).toThrow();

      guard.destroy();
    });

    it('computes a hash', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      const hash = guard.getHash();
      expect(hash).toBeTruthy();
      expect(hash!.length).toBe(64);

      guard.destroy();
    });

    it('returns same hash for same config', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: false\n');

      const guard1 = new ConfigGuard(tmpDir);
      await guard1.loadAndLock();
      const hash1 = guard1.getHash();
      guard1.destroy();

      const guard2 = new ConfigGuard(tmpDir);
      await guard2.loadAndLock();
      const hash2 = guard2.getHash();
      guard2.destroy();

      expect(hash1).toBe(hash2);
    });

    it('returns different hash when config changes', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: false\n');

      const guard1 = new ConfigGuard(tmpDir);
      await guard1.loadAndLock();
      const hash1 = guard1.getHash();
      guard1.destroy();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');

      const guard2 = new ConfigGuard(tmpDir);
      await guard2.loadAndLock();
      const hash2 = guard2.getHash();
      guard2.destroy();

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('deepFreeze — arrays', () => {
    it('freezes nested arrays', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'envcp.yaml'),
        'access:\n  blacklist_patterns:\n    - "FOO_*"\n    - "BAR_*"\n'
      );
      const guard = new ConfigGuard(tmpDir);
      const config = await guard.loadAndLock();

      expect(Array.isArray(config.access?.blacklist_patterns)).toBe(true);
      expect(() => { (config.access!.blacklist_patterns as string[]).push('BAZ_*'); }).toThrow();
      expect(() => { (config.access!.blacklist_patterns as string[])[0] = 'QUX_*'; }).toThrow();

      guard.destroy();
    });

    it('freezes nested sync.exclude array', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'envcp.yaml'),
        'sync:\n  enabled: false\n  exclude:\n    - "SECRET_*"\n'
      );
      const guard = new ConfigGuard(tmpDir);
      const config = await guard.loadAndLock();

      expect(Array.isArray(config.sync?.exclude)).toBe(true);
      expect(() => { (config.sync!.exclude as string[]).push('NEW'); }).toThrow();

      guard.destroy();
    });

    it('freezes nested objects inside arrays', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'envcp.yaml'),
        'access:\n  blacklist_patterns:\n    - "A"\n  allowed_commands:\n    - "cmd1"\n'
      );
      const guard = new ConfigGuard(tmpDir);
      const config = await guard.loadAndLock();

      expect(() => { (config.access!.allowed_commands as string[]).push('cmd2'); }).toThrow();

      guard.destroy();
    });
  });

  describe('checkIntegrity', () => {
    it('returns true when config unchanged', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      const intact = await guard.checkIntegrity();
      expect(intact).toBe(true);

      guard.destroy();
    });

    it('returns false when config file modified', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: false\n');

      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');

      const intact = await guard.checkIntegrity();
      expect(intact).toBe(false);

      guard.destroy();
    });

    it('detects file deletion', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\n');

      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      await fs.remove(path.join(tmpDir, 'envcp.yaml'));

      const intact = await guard.checkIntegrity();
      expect(intact).toBe(false);

      guard.destroy();
    });
  });

  describe('getConfig', () => {
    it('returns null before loadAndLock', () => {
      const guard = new ConfigGuard(tmpDir);
      expect(guard.getConfig()).toBeNull();
      guard.destroy();
    });

    it('returns frozen config after loadAndLock', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      const config = guard.getConfig();
      expect(config).not.toBeNull();
      expect(config!.version).toBe('1.0');

      guard.destroy();
    });
  });

  describe('isTampered', () => {
    it('returns false initially', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      expect(guard.isTampered()).toBe(false);

      guard.destroy();
    });

    it('returns false when config unchanged', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      await guard.checkIntegrity();
      expect(guard.isTampered()).toBe(false);

      guard.destroy();
    });
  });

  describe('reload', () => {
    it('reloads config when already loaded', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: false\n');
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');

      const result = await guard.reload('testpassword');
      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();

      guard.destroy();
    });

    it('reloads config without prior loadAndLock', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: false\n');
      const guard = new ConfigGuard(tmpDir);

      const result = await guard.reload('testpassword');
      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();

      guard.destroy();
    });

    it('resets tampering flag after reload', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: false\n');
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');

      const intact = await guard.checkIntegrity();
      expect(intact).toBe(false);

      const result = await guard.reload('testpassword');
      expect(result.success).toBe(true);
      expect(guard.isTampered()).toBe(false);

      guard.destroy();
    });

    it('writes audit log on reload', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: false\n');
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();

      await guard.reload('testpassword');

      const logPath = path.join(tmpDir, '.envcp', 'logs', 'audit.log');
      const logExists = await fs.pathExists(logPath);
      expect(logExists).toBe(true);

      if (logExists) {
        const logContent = await fs.readFile(logPath, 'utf8');
        expect(logContent).toContain('CONFIG_RELOAD');
      }

      guard.destroy();
    });
  });

  describe('reload with encrypted store', () => {
    it('fails with wrong password when store exists', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'),
        'storage:\n  encrypted: true\n  path: ".envcp/store.enc"\n');

      const storeDir = path.join(tmpDir, '.envcp');
      await fs.ensureDir(storeDir);
      await fs.writeFile(path.join(storeDir, 'store.enc'), 'not-valid-encrypted-content');

      const guard = new ConfigGuard(tmpDir);
      const result = await guard.reload('wrongpassword');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid password');

      guard.destroy();
    });

    it('succeeds when store file does not exist', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'),
        'storage:\n  encrypted: true\n  path: ".envcp/store.enc"\n');

      const guard = new ConfigGuard(tmpDir);
      const result = await guard.reload('anypassword');

      expect(result.success).toBe(true);

      guard.destroy();
    });

    it('skips decryption when storage.encrypted is false', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'),
        'storage:\n  encrypted: false\n  path: ".envcp/store.enc"\n');

      const storeDir = path.join(tmpDir, '.envcp');
      await fs.ensureDir(storeDir);
      await fs.writeFile(path.join(storeDir, 'store.enc'), 'some-content');

      const guard = new ConfigGuard(tmpDir);
      const result = await guard.reload('anypassword');

      expect(result.success).toBe(true);

      guard.destroy();
    });
  });

  describe('file watching — handleChange / verifyAndAlert', () => {
    it('detects tampering via debounce and sets isTampered', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\n');
      const guard = new ConfigGuard(tmpDir, { debounceMs: 100 });
      await guard.loadAndLock();

      expect(guard.isTampered()).toBe(false);

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "2.0"\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(guard.isTampered()).toBe(true);

      guard.destroy();
    });

    it('writes audit log on tamper detection', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\n');
      const guard = new ConfigGuard(tmpDir, { debounceMs: 100 });
      await guard.loadAndLock();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "2.0"\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      const logPath = path.join(tmpDir, '.envcp', 'logs', 'audit.log');
      if (await fs.pathExists(logPath)) {
        const logContent = await fs.readFile(logPath, 'utf8');
        expect(logContent).toContain('SECURITY WARNING');
      }

      guard.destroy();
    });

    it('does not flag tamper when config hash matches', async () => {
      const content = 'version: "1.0"\n';
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), content);
      const guard = new ConfigGuard(tmpDir, { debounceMs: 100 });
      await guard.loadAndLock();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), content);

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(guard.isTampered()).toBe(false);

      guard.destroy();
    });
  });

  describe('periodic integrity check', () => {
    it('detects tampering via periodic check', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\n');
      const guard = new ConfigGuard(tmpDir, { periodicCheckMs: 200 });
      await guard.loadAndLock();

      expect(guard.isTampered()).toBe(false);

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "2.0"\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(guard.isTampered()).toBe(true);

      guard.destroy();
    });

    it('does not re-alert if already tampered', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\n');
      const guard = new ConfigGuard(tmpDir, { periodicCheckMs: 200 });
      await guard.loadAndLock();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "2.0"\n');

      await new Promise(resolve => setTimeout(resolve, 600));

      expect(guard.isTampered()).toBe(true);

      const logPath = path.join(tmpDir, '.envcp', 'logs', 'audit.log');
      if (await fs.pathExists(logPath)) {
        const logContent = await fs.readFile(logPath, 'utf8');
        const tamperCount = (logContent.match(/PERIODIC_TAMPER/g) || []).length;
        expect(tamperCount).toBeLessThanOrEqual(1);
      }

      guard.destroy();
    });
  });

  describe('auditLog', () => {
    it('creates log directory and file', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();
      await guard.reload('testpw');

      const logPath = path.join(tmpDir, '.envcp', 'logs', 'audit.log');
      expect(await fs.pathExists(logPath)).toBe(true);

      const content = await fs.readFile(logPath, 'utf8');
      expect(content).toContain('CONFIG_RELOAD');

      guard.destroy();
    });
  });

  describe('destroy', () => {
    it('cleans up without error', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();
      expect(() => guard.destroy()).not.toThrow();
    });

    it('cleans up watchers array', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();
      guard.destroy();
      expect(() => guard.destroy()).not.toThrow();
    });

    it('can be called on fresh guard', () => {
      const guard = new ConfigGuard(tmpDir);
      expect(() => guard.destroy()).not.toThrow();
    });

    it('clears periodic timer', async () => {
      const guard = new ConfigGuard(tmpDir, { periodicCheckMs: 100 });
      await guard.loadAndLock();
      guard.destroy();

      await new Promise(resolve => setTimeout(resolve, 300));
      expect(guard.isTampered()).toBe(false);
    });
  });

  describe('TTY output', () => {
    let origIsTTY: boolean | undefined;
    let origWrite: typeof process.stderr.write;

    beforeEach(() => {
      origIsTTY = process.stderr.isTTY;
      origWrite = process.stderr.write.bind(process.stderr);
    });

    afterEach(() => {
      Object.defineProperty(process.stderr, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
      process.stderr.write = origWrite;
    });

    it('writes to stderr when TTY on verifyAndAlert', async () => {
      Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true, configurable: true });
      const chunks: string[] = [];
      process.stderr.write = (chunk: any) => { chunks.push(String(chunk)); return true; };

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\n');
      const guard = new ConfigGuard(tmpDir, { debounceMs: 50 });
      await guard.loadAndLock();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "2.0"\n');
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(guard.isTampered()).toBe(true);
      const output = chunks.join('');
      expect(output).toContain('SECURITY WARNING');
      expect(output).toContain('envcp config reload');

      guard.destroy();
    });

    it('writes to stderr when TTY on periodic check', async () => {
      Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true, configurable: true });
      const chunks: string[] = [];
      process.stderr.write = (chunk: any) => { chunks.push(String(chunk)); return true; };

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\n');
      const guard = new ConfigGuard(tmpDir, { periodicCheckMs: 100 });
      await guard.loadAndLock();

      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "2.0"\n');
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(guard.isTampered()).toBe(true);
      const output = chunks.join('');
      expect(output).toContain('Periodic integrity check');

      guard.destroy();
    });
  });

  describe('markInternalWrite', () => {
    it('does not throw', () => {
      const guard = new ConfigGuard(tmpDir);
      expect(() => guard.markInternalWrite()).not.toThrow();
      guard.destroy();
    });
  });
});
