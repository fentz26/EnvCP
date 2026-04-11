import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as nativeFs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StorageManager } from '../src/storage/index';

describe('StorageManager', () => {
  let tmpDir: string;
  let storePath: string;
  const now = new Date().toISOString();

  beforeEach(async () => {
    tmpDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-test-'));
    storePath = path.join(tmpDir, 'store.enc');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves variables (encrypted)', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test123');

    await storage.set('API_KEY', {
      name: 'API_KEY',
      value: 'secret-value',
      encrypted: true,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      sync_to_env: true,
    });

    const result = await storage.get('API_KEY');
    expect(result).toBeDefined();
    expect(result!.value).toBe('secret-value');
  });

  it('lists variable names', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test123');

    const now = new Date().toISOString();
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });
    await storage.set('B', { name: 'B', value: '2', encrypted: true, created: now, updated: now, sync_to_env: true });

    const names = await storage.list();
    expect(names.sort()).toEqual(['A', 'B']);
  });

  it('deletes variables', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test123');

    const now = new Date().toISOString();
    await storage.set('X', { name: 'X', value: 'v', encrypted: true, created: now, updated: now, sync_to_env: true });

    expect(await storage.delete('X')).toBe(true);
    expect(await storage.get('X')).toBeUndefined();
    expect(await storage.delete('X')).toBe(false);
  });

  it('returns empty for non-existent store', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test123');

    const variables = await storage.load();
    expect(variables).toEqual({});
  });

  it('fails with wrong password', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('correct');

    const now = new Date().toISOString();
    await storage.set('KEY', { name: 'KEY', value: 'v', encrypted: true, created: now, updated: now, sync_to_env: true });

    const storage2 = new StorageManager(storePath, true);
    storage2.setPassword('wrong');

    await expect(storage2.load()).rejects.toThrow('Failed to decrypt');
  });

  it('uses cache on subsequent loads', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test123');

    const now = new Date().toISOString();
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });

    // Second load should use cache
    const v1 = await storage.load();
    const v2 = await storage.load();
    expect(v1).toBe(v2); // same reference = cache hit
  });

  it('throws when store path is a directory', async () => {
    await fs.mkdir(storePath);
    const storage = new StorageManager(storePath, false);
    await expect(storage.load()).rejects.toThrow('not a regular file');
  });

  it('throws ELOOP error for symlink', async () => {
    await fs.symlink('/nonexistent/target', storePath);
    const storage = new StorageManager(storePath, false);
    await expect(storage.load()).rejects.toThrow('not a regular file');
  });

  it('re-throws unexpected errors during load', async () => {
    await fs.writeFile(storePath, 'data', { mode: 0o000 });
    const storage = new StorageManager(storePath, false);
    await expect(storage.load()).rejects.toThrow();
  });

  it('uses default constructor params', async () => {
    const storage = new StorageManager(storePath);
    storage.setPassword('test123');
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });
    const result = await storage.get('A');
    expect(result!.value).toBe('1');
  });

  it('verifies store with valid data', async () => {
    const storage = new StorageManager(storePath, false);
    const now = new Date().toISOString();
    await storage.set('V', { name: 'V', value: 'test', encrypted: false, created: now, updated: now, sync_to_env: true });
    const result = await storage.verify();
    expect(result.valid).toBe(true);
    expect(result.count).toBe(1);
    expect(result.backups).toBeGreaterThanOrEqual(0);
  });

  it('verifies store with empty file', async () => {
    await fs.writeFile(storePath, '');
    const storage = new StorageManager(storePath, false);
    const result = await storage.verify();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('verifies store with corrupted data', async () => {
    await fs.writeFile(storePath, 'not-json');
    const storage = new StorageManager(storePath, false);
    const result = await storage.verify();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('verification failed');
  });

  it('verifies store when file does not exist', async () => {
    const storage = new StorageManager(path.join(tmpDir, 'nonexistent'), false);
    const result = await storage.verify();
    expect(result.valid).toBe(false);
  });

  it('exists() returns true when store file exists', async () => {
    const storage = new StorageManager(storePath, false);
    await storage.set('A', { name: 'A', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true });
    expect(await storage.exists()).toBe(true);
  });

  it('exists() returns false when store file does not exist', async () => {
    const storage = new StorageManager(path.join(tmpDir, 'nope'), false);
    expect(await storage.exists()).toBe(false);
  });

  it('invalidateCache clears cache', async () => {
    const storage = new StorageManager(storePath, false);
    await storage.set('A', { name: 'A', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.load();
    storage.invalidateCache();
    const v = await storage.load();
    expect(v).toEqual({ A: { name: 'A', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true } });
  });

  it('rotates backups on save', async () => {
    const storage = new StorageManager(storePath, false, 3);
    await storage.set('A', { name: 'A', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.set('B', { name: 'B', value: '2', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.set('C', { name: 'C', value: '3', encrypted: false, created: now, updated: now, sync_to_env: true });
    expect(await pathExists(storePath + '.bak.1')).toBe(true);
    expect(await pathExists(storePath + '.bak.2')).toBe(true);
  });

  it('setPassword clears cache when password changes', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('pass1');
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });
    storage.setPassword('pass2');
    const cache = (storage as any).cache;
    expect(cache).toBeNull();
  });

  it('setPassword keeps cache when same password', async () => {
    const storage = new StorageManager(storePath, true);
    storage.setPassword('pass1');
    await storage.set('A', { name: 'A', value: '1', encrypted: true, created: now, updated: now, sync_to_env: true });
    await storage.load();
    storage.setPassword('pass1');
    const cache = (storage as any).cache;
    expect(cache).not.toBeNull();
  });

  it('skips backups when maxBackups is 0', async () => {
    const storage = new StorageManager(storePath, false, 0);
    await storage.set('A', { name: 'A', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true });
    expect(await pathExists(storePath + '.bak.1')).toBe(false);
  });

  it('rotates backups shifting existing ones', async () => {
    const storage = new StorageManager(storePath, false, 3);
    await storage.set('A', { name: 'A', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.set('B', { name: 'B', value: '2', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.set('C', { name: 'C', value: '3', encrypted: false, created: now, updated: now, sync_to_env: true });
    expect(await pathExists(storePath + '.bak.1')).toBe(true);
    expect(await pathExists(storePath + '.bak.2')).toBe(true);
    const bak1 = await fs.readFile(storePath + '.bak.1', 'utf8');
    expect(bak1).toContain('B');
  });
});
