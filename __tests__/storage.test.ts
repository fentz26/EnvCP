import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { StorageManager } from '../src/storage/index';

describe('StorageManager', () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-test-'));
    storePath = path.join(tmpDir, 'store.enc');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
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
});
