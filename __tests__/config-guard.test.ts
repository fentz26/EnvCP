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

  describe('destroy', () => {
    it('cleans up without error', async () => {
      const guard = new ConfigGuard(tmpDir);
      await guard.loadAndLock();
      expect(() => guard.destroy()).not.toThrow();
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
