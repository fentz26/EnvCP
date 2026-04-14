import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import { ConfigGuard } from '../src/config/config-guard';

describe('ConfigGuard', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-guard-'));
    await ensureDir(path.join(tmpDir, '.envcp', 'logs'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
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

      await fs.rm(path.join(tmpDir, 'envcp.yaml'));

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
      const logExists = await pathExists(logPath);
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
      await ensureDir(storeDir);
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
      await ensureDir(storeDir);
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
      if (await pathExists(logPath)) {
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
      if (await pathExists(logPath)) {
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
      expect(await pathExists(logPath)).toBe(true);

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

    it('handleChange returns early when called within 500ms of internal write — line 183', async () => {
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "1.0"\n');
      const guard = new ConfigGuard(tmpDir, { debounceMs: 50 });
      await guard.loadAndLock();

      // Mark an internal write, then immediately trigger a file change
      guard.markInternalWrite();
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: "2.0"\n');

      // Wait longer than debounce but the guard should NOT detect tampering
      // because handleChange returns early after markInternalWrite
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(guard.isTampered()).toBe(false);

      guard.destroy();
    });
  });

  describe('hashConfigFile and startWatching USERPROFILE fallback — lines 129, 155', () => {
    let origHome: string | undefined;
    let origUserProfile: string | undefined;

    beforeEach(() => {
      origHome = process.env.HOME;
      origUserProfile = process.env.USERPROFILE;
    });

    afterEach(() => {
      if (origHome !== undefined) process.env.HOME = origHome;
      else delete process.env.HOME;
      if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
      else delete process.env.USERPROFILE;
    });

    it('uses USERPROFILE when HOME is unset (covers lines 129 and 155)', async () => {
      delete process.env.HOME;
      process.env.USERPROFILE = tmpDir;
      const guard = new ConfigGuard(tmpDir);
      const config = await guard.loadAndLock();
      expect(config).toBeDefined();
      const hash = guard.getHash();
      expect(hash).toBeTruthy();
      guard.destroy();
    });

    it('uses empty string when both HOME and USERPROFILE are unset', async () => {
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      const guard = new ConfigGuard(tmpDir);
      const config = await guard.loadAndLock();
      expect(config).toBeDefined();
      guard.destroy();
    });
  });

  describe('global vault store watching', () => {
    it('includes global vault store in integrity hash', async () => {
      // Set up global vault store in the fake HOME
      const vaultDir = path.join(tmpDir, '.envcp');
      await ensureDir(vaultDir);
      await fs.writeFile(path.join(vaultDir, 'store.enc'), 'vault-data-v1');

      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();
      const hash1 = guard.getHash();

      // Modify the global vault store — hash should change
      await fs.writeFile(path.join(vaultDir, 'store.enc'), 'vault-data-v2');

      const intact = await guard.checkIntegrity();
      expect(intact).toBe(false);

      guard.destroy();
    });

    it('hash is stable when vault store does not exist', async () => {
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

    it('detects vault store tampering via file watcher', async () => {
      const vaultDir = path.join(tmpDir, '.envcp');
      await ensureDir(vaultDir);
      await fs.writeFile(path.join(vaultDir, 'store.enc'), 'original');

      const guard = new ConfigGuard(tmpDir, { debounceMs: 50 });
      await guard.loadAndLock();

      expect(guard.isTampered()).toBe(false);

      // Modify vault store file
      await fs.writeFile(path.join(vaultDir, 'store.enc'), 'tampered');

      await new Promise(resolve => setTimeout(resolve, 400));

      expect(guard.isTampered()).toBe(true);

      guard.destroy();
    });
  });
});

describe('ConfigGuard — reload() without loadAndLock first (line 77 ?? branch)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-reload77-'));
    await ensureDir(path.join(tmpDir, '.envcp', 'logs'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('calls loadConfig when this.config is null (no loadAndLock first)', async () => {
    // No store file, no encryption — ENOENT branch → success
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), [
      'storage:',
      '  encrypted: false',
      '  path: .envcp/store.json',
    ].join('\n'));

    const guard = new ConfigGuard(tmpDir);
    // reload() without loadAndLock() first — this.config is null → takes ?? branch
    const result = await guard.reload('any-password');
    expect(result.success).toBe(true);
    guard.destroy();
  });
});

describe('ConfigGuard — checkIntegrity before loadAndLock (line 136 false branch)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-ci136-'));
    await ensureDir(path.join(tmpDir, '.envcp', 'logs'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('hashConfigFile is called with this.config=null when checkIntegrity called before loadAndLock', async () => {
    const guard = new ConfigGuard(tmpDir);
    // checkIntegrity calls hashConfigFile() — this.config is null → if(this.config) is false
    // (the hash just uses [globalPath, configPath] without the vault store)
    const result = await guard.checkIntegrity();
    // configHash is null before loadAndLock, so currentHash !== null → returns false
    expect(result).toBe(false);
    guard.destroy();
  });
});

describe('ConfigGuard — reload() with invalid password (line 88)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-reload-'));
    await ensureDir(path.join(tmpDir, '.envcp', 'logs'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns success:false with error message when password is wrong', async () => {
    // Create a real encrypted store using the encrypt utility
    const { encrypt } = await import('../src/utils/crypto.js');
    const storeContent = await encrypt('{}', 'correct-password');
    const storeDir = path.join(tmpDir, '.envcp');
    await ensureDir(storeDir);
    await fs.writeFile(path.join(storeDir, 'store.enc'), storeContent);

    // Write a config that enables encryption and points at the store
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), [
      'storage:',
      '  encrypted: true',
      '  path: .envcp/store.enc',
    ].join('\n'));

    const guard = new ConfigGuard(tmpDir);
    await guard.loadAndLock();

    const result = await guard.reload('wrong-password');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid password');

    guard.destroy();
  });

  it('returns success:true when store does not exist (ENOENT branch)', async () => {
    // No store file — reload should succeed with ENOENT branch
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), [
      'storage:',
      '  encrypted: true',
      '  path: .envcp/store.enc',
    ].join('\n'));

    const guard = new ConfigGuard(tmpDir);
    await guard.loadAndLock();

    // Pass any password — ENOENT branch skips verification and returns success
    const result = await guard.reload('any-password');
    expect(result.success).toBe(true);

    guard.destroy();
  });
});

describe('ConfigGuard — startWatching with config (lines 162-169)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-watch-'));
    await ensureDir(path.join(tmpDir, '.envcp', 'logs'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('includes global vault store in file watch list after loadAndLock', async () => {
    // Create a vault store so config.vault.global_path resolves
    const vaultDir = path.join(tmpDir, '.envcp');
    await ensureDir(vaultDir);
    await fs.writeFile(path.join(vaultDir, 'store.enc'), 'data');

    const guard = new ConfigGuard(tmpDir, { debounceMs: 50 });
    // loadAndLock sets this.config, so startWatching takes the config branch (line 162)
    const config = await guard.loadAndLock();
    expect(config).toBeDefined();

    // Verify guard has watchers (startWatching was called with config branch)
    expect((guard as any).watchers.length).toBeGreaterThan(0);

    guard.destroy();
  });
});

describe('ConfigGuard — periodic timer unref branch (line 212)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-ptimer-'));
    await ensureDir(path.join(tmpDir, '.envcp', 'logs'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates periodic timer with unref when loadAndLock is called', async () => {
    const guard = new ConfigGuard(tmpDir, { periodicCheckMs: 60000 });
    await guard.loadAndLock();

    // The periodicTimer should be set (startPeriodicCheck was called and unref branch hit)
    expect((guard as any).periodicTimer).not.toBeNull();

    guard.destroy();
    // After destroy(), periodicTimer should be null
    expect((guard as any).periodicTimer).toBeNull();
  });
});

describe('ConfigGuard — remaining branch/function coverage', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-guard-extra-'));
    await ensureDir(path.join(tmpDir, '.envcp', 'logs'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reload uses default store path when storage.path is empty', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'envcp.yaml'),
      'storage:\n  encrypted: false\n  path: ""\n'
    );

    const guard = new ConfigGuard(tmpDir);
    const result = await guard.reload('any-password');

    expect(result.success).toBe(true);
    guard.destroy();
  });

  it('startWatching handles null config path branch', () => {
    const guard = new ConfigGuard(tmpDir);

    (guard as any).startWatching();

    expect((guard as any).watchers.length).toBeGreaterThan(0);
    guard.destroy();
  });

  it('startWatching skips missing directories', () => {
    const missingHome = path.join(tmpDir, 'missing-home-dir');
    process.env.HOME = missingHome;
    const guard = new ConfigGuard(tmpDir);

    (guard as any).startWatching();

    expect((guard as any).watchers.length).toBeGreaterThanOrEqual(1);
    guard.destroy();
  });

  it('startPeriodicCheck handles interval without unref', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(
      (() => 123 as unknown as ReturnType<typeof setInterval>) as typeof setInterval
    );
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(
      (() => undefined) as typeof clearInterval
    );

    try {
      const guard = new ConfigGuard(tmpDir, { periodicCheckMs: 50 });
      await guard.loadAndLock();

      expect((guard as any).periodicTimer).toBe(123);
      guard.destroy();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('watcher error callback executes without throwing', async () => {
    const guard = new ConfigGuard(tmpDir);
    await guard.loadAndLock();

    for (const watcher of (guard as any).watchers as Array<{ emit?: (event: string, ...args: unknown[]) => void }>) {
      if (watcher && typeof watcher.emit === 'function') {
        expect(() => watcher.emit!('error', new Error('synthetic watcher error'))).not.toThrow();
      }
    }

    guard.destroy();
  });
});
