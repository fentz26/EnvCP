import fs from 'fs-extra';
import * as nativeFs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StorageManager, LogManager } from '../src/storage/index';

describe('StorageManager advanced', () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-store-'));
    storePath = path.join(tmpDir, '.envcp', 'store.enc');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('works in plaintext (unencrypted) mode', async () => {
    const storage = new StorageManager(storePath, false);
    const now = new Date().toISOString();
    await storage.set('KEY', { name: 'KEY', value: 'plain', encrypted: false, created: now, updated: now, sync_to_env: true });
    const result = await storage.get('KEY');
    expect(result!.value).toBe('plain');

    // Verify it's stored as readable JSON
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.KEY.value).toBe('plain');
  });

  it('exists() returns true when store exists', async () => {
    const storage = new StorageManager(storePath, false);
    expect(await storage.exists()).toBe(false);
    const now = new Date().toISOString();
    await storage.set('X', { name: 'X', value: 'v', encrypted: false, created: now, updated: now, sync_to_env: true });
    expect(await storage.exists()).toBe(true);
  });

  it('invalidateCache forces reload', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test');
    const now = new Date().toISOString();
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });

    const v1 = await storage.load();
    storage.invalidateCache();
    const v2 = await storage.load();
    expect(v1).not.toBe(v2); // different references after invalidation
    expect(v2.A.value).toBe('1');
  });

  it('setPassword with same password keeps cache', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test');
    const now = new Date().toISOString();
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });

    const v1 = await storage.load();
    storage.setPassword('test'); // same password
    const v2 = await storage.load();
    expect(v1).toBe(v2); // same cache reference
  });

  it('setPassword with different password invalidates cache', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test');
    const now = new Date().toISOString();
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });

    await storage.load();
    storage.setPassword('different');
    // Cache is invalidated; load will attempt decrypt with wrong password
    await expect(storage.load()).rejects.toThrow();
  });

  it('creates backups on save', async () => {
    const storage = new StorageManager(storePath, false, 2);
    const now = new Date().toISOString();
    await storage.set('V1', { name: 'V1', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.set('V2', { name: 'V2', value: '2', encrypted: false, created: now, updated: now, sync_to_env: true });

    expect(await fs.pathExists(`${storePath}.bak.1`)).toBe(true);
  });

  it('verify returns valid for healthy store', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test');
    const now = new Date().toISOString();
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });

    const result = await storage.verify();
    expect(result.valid).toBe(true);
    expect(result.count).toBe(1);
  });

  it('verify returns invalid for non-existent store', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test');
    const result = await storage.verify();
    expect(result.valid).toBe(false);
  });

  it('verify returns invalid for empty store', async () => {
    await fs.ensureDir(path.dirname(storePath));
    await fs.writeFile(storePath, '');
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test');
    const result = await storage.verify();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('verify counts backups', async () => {
    const storage = new StorageManager(storePath, false, 3);
    const now = new Date().toISOString();
    // Write multiple times to create backups
    for (let i = 0; i < 4; i++) {
      storage.invalidateCache();
      await storage.set(`V${i}`, { name: `V${i}`, value: `${i}`, encrypted: false, created: now, updated: now, sync_to_env: true });
    }

    const result = await storage.verify();
    expect(result.valid).toBe(true);
    expect(result.backups).toBeGreaterThan(0);
  });

  it('throws for symlink store path', async () => {
    const realFile = path.join(tmpDir, 'real.enc');
    await fs.writeFile(realFile, 'data');
    const symlinkPath = path.join(tmpDir, 'symlink.enc');
    await fs.symlink(realFile, symlinkPath);

    const storage = new StorageManager(symlinkPath, false);
    await expect(storage.load()).rejects.toThrow('not a regular file');
  });
});

describe('LogManager', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-log-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('creates log directory on init', async () => {
    const logger = new LogManager(logDir);
    await logger.init();
    expect(await fs.pathExists(logDir)).toBe(true);
  });

  it('writes log entries', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    await logger.log({
      timestamp: new Date().toISOString(),
      operation: 'get',
      variable: 'TEST',
      source: 'api',
      success: true,
      message: 'Test log entry',
    });

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `operations-${date}.log`);
    const content = await fs.readFile(logFile, 'utf8');
    expect(content).toContain('Test log entry');
  });

  it('retrieves logs for a date', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    await logger.log({
      timestamp: new Date().toISOString(),
      operation: 'add',
      variable: 'A',
      source: 'cli',
      success: true,
    });

    const logs = await logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].variable).toBe('A');
  });

  it('returns empty array for missing date', async () => {
    const logger = new LogManager(logDir);
    await logger.init();
    const logs = await logger.getLogs('2000-01-01');
    expect(logs).toEqual([]);
  });
});
