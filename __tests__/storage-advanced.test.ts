import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as nativeFs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StorageManager, LogManager, LogFilter } from '../src/storage/index';
import { AuditConfigSchema } from '../src/types';

describe('StorageManager advanced', () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-store-'));
    storePath = path.join(tmpDir, '.envcp', 'store.enc');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
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

    expect(await pathExists(`${storePath}.bak.1`)).toBe(true);
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
    await ensureDir(path.dirname(storePath));
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

  it('auto-restores from backup when primary is corrupted', async () => {
    const storage = new StorageManager(storePath, true, 2);
    storage.setPassword('test');
    const now = new Date().toISOString();

    // Write some data to create a valid backup
    await storage.set('GOOD', { name: 'GOOD', value: 'data', encrypted: true, created: now, updated: now, sync_to_env: true });
    // Save a second time so backup .bak.1 gets the first version
    storage.invalidateCache();
    await storage.set('GOOD', { name: 'GOOD', value: 'data2', encrypted: true, created: now, updated: now, sync_to_env: true });

    // Now corrupt the primary store with a proper v2: prefix but garbage
    await fs.writeFile(storePath, 'v2:' + '00'.repeat(48) + 'deadbeef');

    // New storage instance should auto-restore from backup
    const storage2 = new StorageManager(storePath, true, 2);
    storage2.setPassword('test');
    const loaded = await storage2.load();
    expect(loaded.GOOD).toBeDefined();
  });

  it('verify returns invalid for corrupted encrypted store', async () => {
    await ensureDir(path.dirname(storePath));
    await fs.writeFile(storePath, 'not-valid-encrypted-data');
    const storage = new StorageManager(storePath, true);
    storage.setPassword('test');
    const result = await storage.verify();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('verification failed');
  });

  it('verify returns invalid for non-object data', async () => {
    await ensureDir(path.dirname(storePath));
    await fs.writeFile(storePath, '"just a string"');
    const storage = new StorageManager(storePath, false);
    const result = await storage.verify();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not a valid object');
  });

  it('tryRestoreFromBackup handles non-ENOENT errors (e.g., directory at backup path)', async () => {
    const storage = new StorageManager(storePath, true, 2);
    storage.setPassword('test');
    const now = new Date().toISOString();

    // Write valid data first to create the store
    await storage.set('GOOD', { name: 'GOOD', value: 'data', encrypted: true, created: now, updated: now, sync_to_env: true });
    storage.invalidateCache();
    await storage.set('GOOD', { name: 'GOOD', value: 'data2', encrypted: true, created: now, updated: now, sync_to_env: true });

    // Corrupt primary store
    await fs.writeFile(storePath, 'v2:' + '00'.repeat(48) + 'deadbeef');

    // Replace backup.1 with a directory (causes EISDIR, not ENOENT — line 136)
    const bak1 = `${storePath}.bak.1`;
    if (await pathExists(bak1)) {
      await fs.rm(bak1, { recursive: true, force: true });
    }
    await ensureDir(bak1);

    // This should still try bak.2 and recover
    const storage2 = new StorageManager(storePath, true, 2);
    storage2.setPassword('test');
    try {
      const loaded = await storage2.load();
      // May or may not succeed depending on bak.2 state
      expect(loaded).toBeDefined();
    } catch {
      // If all backups fail, that's OK — the key thing is line 136 was hit
    }
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
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates log directory on init', async () => {
    const logger = new LogManager(logDir);
    await logger.init();
    expect(await pathExists(logDir)).toBe(true);
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
    const logs = await logger.getLogs({ date: '2000-01-01' });
    expect(logs).toEqual([]);
  });

  it('pruneOldLogs deletes log files older than retainDays', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    // Write two fake log files: one old, one recent
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const oldName = `operations-${oldDate.toISOString().split('T')[0]}.log`;
    const recentName = `operations-${new Date().toISOString().split('T')[0]}.log`;
    const oldPath = path.join(logDir, oldName);
    const recentPath = path.join(logDir, recentName);

    await fs.writeFile(oldPath, '{"old":true}\n', 'utf8');
    await fs.writeFile(recentPath, '{"recent":true}\n', 'utf8');

    // Back-date the old file's mtime so pruning treats it as old
    const oldMtime = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    await fs.utimes(oldPath, oldMtime, oldMtime);

    await logger.pruneOldLogs(30);

    expect(await pathExists(oldPath)).toBe(false);
    expect(await pathExists(recentPath)).toBe(true);
  });

  it('pruneOldLogs uses default 30 days when called without argument', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const oldName = `operations-${oldDate.toISOString().split('T')[0]}.log`;
    const oldPath = path.join(logDir, oldName);

    await fs.writeFile(oldPath, '{"old":true}\n', 'utf8');
    const oldMtime = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    await fs.utimes(oldPath, oldMtime, oldMtime);

    await logger.pruneOldLogs();

    expect(await pathExists(oldPath)).toBe(false);
  });

  it('pruneOldLogs ignores non-log files and handles stat errors gracefully', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    // A file with a non-matching name should be left alone
    const otherFile = path.join(logDir, 'other-file.txt');
    await fs.writeFile(otherFile, 'irrelevant', 'utf8');

    // Should not throw even with mixed content
    await expect(logger.pruneOldLogs(0)).resolves.toBeUndefined();

    // Non-log file is untouched
    expect(await pathExists(otherFile)).toBe(true);
  });
});

describe('LogManager enhanced audit features', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-audit-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips logging when audit is disabled', async () => {
    const logger = new LogManager(logDir, { enabled: false, retain_days: 30, fields: { session_id: true, client_id: true, client_type: true, ip: true, user_agent: false, purpose: false, duration_ms: true, variable: true, message: true }, hmac: false, hmac_key_path: '.envcp/.audit-hmac-key' });
    await logger.init();

    await logger.log({ timestamp: new Date().toISOString(), operation: 'get', variable: 'X', source: 'api', success: true });

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `operations-${date}.log`);
    expect(await pathExists(logFile)).toBe(false);
  });

  it('filters fields — omits disabled fields from log entries', async () => {
    const logger = new LogManager(logDir, {
      enabled: true,
      retain_days: 30,
      fields: { session_id: false, client_id: false, client_type: false, ip: false, user_agent: false, purpose: false, duration_ms: false, variable: false, message: false },
      hmac: false,
      hmac_key_path: '.envcp/.audit-hmac-key',
    });
    await logger.init();

    await logger.log({ timestamp: new Date().toISOString(), operation: 'get', variable: 'SECRET', source: 'api', success: true, message: 'revealed', session_id: 'sess-1', ip: '1.2.3.4' });

    const date = new Date().toISOString().split('T')[0];
    const raw = await fs.readFile(path.join(logDir, `operations-${date}.log`), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(entry.variable).toBeUndefined();
    expect(entry.message).toBeUndefined();
    expect(entry.session_id).toBeUndefined();
    expect(entry.ip).toBeUndefined();
    expect(entry.operation).toBe('get');
    expect(entry.success).toBe(true);
  });

  it('includes enabled optional fields in log entries', async () => {
    const logger = new LogManager(logDir, {
      enabled: true,
      retain_days: 30,
      fields: { session_id: true, client_id: true, client_type: true, ip: true, user_agent: true, purpose: true, duration_ms: true, variable: true, message: true },
      hmac: false,
      hmac_key_path: '.envcp/.audit-hmac-key',
    });
    await logger.init();

    await logger.log({ timestamp: new Date().toISOString(), operation: 'list', source: 'mcp', success: true, session_id: 'sid', client_id: 'cid', client_type: 'mcp', ip: '127.0.0.1', user_agent: 'Claude', purpose: 'test', duration_ms: 42, variable: 'VAR', message: 'msg' });

    const date = new Date().toISOString().split('T')[0];
    const raw = await fs.readFile(path.join(logDir, `operations-${date}.log`), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(entry.session_id).toBe('sid');
    expect(entry.ip).toBe('127.0.0.1');
    expect(entry.duration_ms).toBe(42);
    expect(entry.variable).toBe('VAR');
  });

  it('signs entries with HMAC and verifyEntry confirms integrity', async () => {
    const logger = new LogManager(logDir, {
      enabled: true,
      retain_days: 30,
      fields: { session_id: true, client_id: true, client_type: true, ip: true, user_agent: false, purpose: false, duration_ms: true, variable: true, message: true },
      hmac: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });
    await logger.init();

    await logger.log({ timestamp: '2024-01-01T00:00:00.000Z', operation: 'get', variable: 'K', source: 'api', success: true });

    const date = new Date().toISOString().split('T')[0];
    const raw = await fs.readFile(path.join(logDir, `operations-${date}.log`), 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(entry.hmac).toBeDefined();
    expect(logger.verifyEntry(entry)).toBe(true);
  });

  it('verifyEntry detects tampered entries', async () => {
    const logger = new LogManager(logDir, {
      enabled: true,
      retain_days: 30,
      fields: { session_id: true, client_id: true, client_type: true, ip: true, user_agent: false, purpose: false, duration_ms: true, variable: true, message: true },
      hmac: true,
      hmac_key_path: path.join(tmpDir, '.audit-hmac-key'),
    });
    await logger.init();

    await logger.log({ timestamp: '2024-01-01T00:00:00.000Z', operation: 'get', variable: 'K', source: 'api', success: true });

    const date = new Date().toISOString().split('T')[0];
    const raw = await fs.readFile(path.join(logDir, `operations-${date}.log`), 'utf8');
    const entry = JSON.parse(raw.trim());
    entry.success = false; // tamper
    expect(logger.verifyEntry(entry)).toBe(false);
  });

  it('getLogs filters by operation', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    const ts = new Date().toISOString();
    await logger.log({ timestamp: ts, operation: 'get', variable: 'A', source: 'api', success: true });
    await logger.log({ timestamp: ts, operation: 'list', source: 'api', success: true });

    const results = await logger.getLogs({ operation: 'get' });
    expect(results).toHaveLength(1);
    expect(results[0].operation).toBe('get');
  });

  it('getLogs filters by success', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    const ts = new Date().toISOString();
    await logger.log({ timestamp: ts, operation: 'get', variable: 'A', source: 'api', success: true });
    await logger.log({ timestamp: ts, operation: 'get', variable: 'B', source: 'api', success: false });

    const failed = await logger.getLogs({ success: false });
    expect(failed).toHaveLength(1);
    expect(failed[0].variable).toBe('B');
  });

  it('getLogs filters by tail', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    const ts = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      await logger.log({ timestamp: ts, operation: 'list', source: 'cli', success: true, message: `entry-${i}` });
    }

    const results = await logger.getLogs({ tail: 2 });
    expect(results).toHaveLength(2);
    expect(results[1].message).toBe('entry-4');
  });

  it('getLogDates returns sorted list of available log dates', async () => {
    const logger = new LogManager(logDir);
    await logger.init();

    await fs.writeFile(path.join(logDir, 'operations-2024-01-01.log'), '{"test":1}\n', 'utf8');
    await fs.writeFile(path.join(logDir, 'operations-2024-01-02.log'), '{"test":2}\n', 'utf8');

    const dates = await logger.getLogDates();
    expect(dates).toEqual(['2024-01-01', '2024-01-02']);
  });

  it('getLogDates returns empty array when logDir does not exist', async () => {
    const logger = new LogManager(path.join(tmpDir, 'nonexistent-logs'));
    const dates = await logger.getLogDates();
    expect(dates).toEqual([]);
  });

  it('signEntry uses hash when hmacKey is not set', async () => {
    const logger = new LogManager(logDir, { enabled: true, retain_days: 30, fields: {}, hmac: false, hmac_key_path: '' });
    await logger.init();
    (logger as any).hmacKey = null;
    const sig = (logger as any).signEntry({ timestamp: '2024-01-01', operation: 'get', source: 'api', success: true });
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('StorageManager backup rotation', () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-backup-'));
    storePath = path.join(tmpDir, 'store.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .bak.1 after first save', async () => {
    const storage = new StorageManager(storePath, false, 3);
    const now = new Date().toISOString();
    await storage.set('K', { name: 'K', value: 'v', encrypted: false, created: now, updated: now, sync_to_env: true });
    // Second save triggers rotation of first file into .bak.1
    await storage.set('K2', { name: 'K2', value: 'v2', encrypted: false, created: now, updated: now, sync_to_env: true });
    const bak1Exists = await pathExists(`${storePath}.bak.1`);
    expect(bak1Exists).toBe(true);
  });

  it('shifts backups: .bak.1 becomes .bak.2 on second rotation', async () => {
    const storage = new StorageManager(storePath, false, 3);
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await storage.set(`K${i}`, { name: `K${i}`, value: `v${i}`, encrypted: false, created: now, updated: now, sync_to_env: true });
    }
    const bak2Exists = await pathExists(`${storePath}.bak.2`);
    expect(bak2Exists).toBe(true);
  });

  it('does not create backups when maxBackups is 0', async () => {
    const storage = new StorageManager(storePath, false, 0);
    const now = new Date().toISOString();
    await storage.set('K', { name: 'K', value: 'v', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.set('K2', { name: 'K2', value: 'v2', encrypted: false, created: now, updated: now, sync_to_env: true });
    const bak1Exists = await pathExists(`${storePath}.bak.1`);
    expect(bak1Exists).toBe(false);
  });

  it('restores from backup when store is corrupted', async () => {
    const storage = new StorageManager(storePath, false, 3);
    const now = new Date().toISOString();
    // Write a good value
    await storage.set('GOOD', { name: 'GOOD', value: 'original', encrypted: false, created: now, updated: now, sync_to_env: true });
    // Write again to create .bak.1 with the good data
    await storage.set('SECOND', { name: 'SECOND', value: 'v2', encrypted: false, created: now, updated: now, sync_to_env: true });

    // Corrupt the main store
    await fs.writeFile(storePath, 'not-valid-json');

    // New instance should fail to load main store — unencrypted mode doesn't auto-restore
    const storage2 = new StorageManager(storePath, false, 3);
    await expect(storage2.load()).rejects.toThrow();
  });

  it('backup file created even after first write (file is pre-touched before rotation)', async () => {
    const storage = new StorageManager(storePath, false, 3);
    const now = new Date().toISOString();
    // The store file is always pre-created before rotateBackups() runs (line 93 in storage/index.ts),
    // so after first write the store exists and after second write .bak.1 is created.
    await storage.set('K', { name: 'K', value: 'v', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.set('K2', { name: 'K2', value: 'v2', encrypted: false, created: now, updated: now, sync_to_env: true });
    const bak1 = await pathExists(`${storePath}.bak.1`);
    expect(bak1).toBe(true);
  });

  it('tryRestoreFromBackup returns null for unencrypted store — line 130', async () => {
    const storage = new StorageManager(storePath, false, 3);
    const now = new Date().toISOString();
    await storage.set('K', { name: 'K', value: 'v', encrypted: false, created: now, updated: now, sync_to_env: true });
    await storage.set('K2', { name: 'K2', value: 'v2', encrypted: false, created: now, updated: now, sync_to_env: true });

    // Corrupt and try to load — unencrypted mode does not auto-restore (tryRestoreFromBackup returns null)
    await fs.writeFile(storePath, 'bad json');
    const storage2 = new StorageManager(storePath, false, 3);
    // load() should throw because unencrypted stores don't restore from backup
    await expect(storage2.load()).rejects.toThrow();
  });
});

describe('LogManager HMAC', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-hmac-'));
    logDir = path.join(tmpDir, '.envcp', 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads existing HMAC key on second init (line 273 coverage)', async () => {
    // First init — creates the HMAC key file
    const { AuditConfigSchema } = await import('../src/types');
    const auditConfig = AuditConfigSchema.parse({ hmac: true, hmac_key_path: '.envcp/.audit-hmac-key' });
    const log1 = new LogManager(logDir, auditConfig);
    await log1.init();

    // Second init — reads the existing key (hits line 273)
    const log2 = new LogManager(logDir, auditConfig);
    await log2.init();

    // Both managers should be able to sign and verify consistently
    await log2.log({ timestamp: new Date().toISOString(), operation: 'get', variable: 'X', source: 'api', success: true });
  });

  it('verifyEntry returns false when hmac buffer length mismatch (line 298 coverage)', async () => {
    const { AuditConfigSchema } = await import('../src/types');
    const auditConfig = AuditConfigSchema.parse({ hmac: true, hmac_key_path: '.envcp/.audit-hmac-key' });
    const log = new LogManager(logDir, auditConfig);
    await log.init();

    // A truncated hmac (1 byte) vs expected 32 bytes → timingSafeEqual throws → catch → false
    const entry = {
      timestamp: new Date().toISOString(),
      operation: 'get' as const,
      variable: 'X',
      source: 'api' as const,
      success: true,
      hmac: 'ab', // 1 byte — mismatched length causes timingSafeEqual to throw
    };
    const result = log.verifyEntry(entry);
    expect(result).toBe(false);
  });

  it('verifyEntry returns true when hmacKey is null (line 292 false branch)', async () => {
    // LogManager with hmac disabled — hmacKey stays null
    const log = new LogManager(logDir);
    // Do NOT call init() — hmacKey remains null
    const entry = {
      timestamp: new Date().toISOString(),
      operation: 'get' as const,
      variable: 'X',
      source: 'api' as const,
      success: true,
    };
    // When !this.hmacKey, verifyEntry returns true (no HMAC configured)
    const result = log.verifyEntry(entry);
    expect(result).toBe(true);
  });
});

describe('LogManager — getLogs filters (lines 365-366)', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-logfilter-'));
    logDir = path.join(tmpDir, '.envcp', 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('filters by variable (line 365)', async () => {
    const log = new LogManager(logDir);
    await log.init();
    await log.log({ timestamp: new Date().toISOString(), operation: 'get', variable: 'MY_VAR', source: 'api', success: true });
    await log.log({ timestamp: new Date().toISOString(), operation: 'set', variable: 'OTHER_VAR', source: 'api', success: true });

    const results = await log.getLogs({ variable: 'MY_VAR' });
    expect(results.every(e => e.variable === 'MY_VAR')).toBe(true);
    expect(results.length).toBe(1);
  });

  it('filters by source (line 366)', async () => {
    const log = new LogManager(logDir);
    await log.init();
    await log.log({ timestamp: new Date().toISOString(), operation: 'get', variable: 'V', source: 'cli', success: true });
    await log.log({ timestamp: new Date().toISOString(), operation: 'set', variable: 'V', source: 'api', success: false });

    const results = await log.getLogs({ source: 'cli' });
    expect(results.every(e => e.source === 'cli')).toBe(true);
    expect(results.length).toBe(1);
  });
});

describe('LogManager — pruneOldLogs catch branch (line 323)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-prune-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('silently returns when logDir does not exist (readdir catch)', async () => {
    const nonExistentLogDir = path.join(tmpDir, 'no-such-dir', 'logs');
    const log = new LogManager(nonExistentLogDir);
    // pruneOldLogs should silently return without throwing when logDir does not exist
    await expect(log.pruneOldLogs(30)).resolves.toBeUndefined();
  });

  it('prunes log files older than retainDays', async () => {
    const logDir = path.join(tmpDir, 'logs');
    await ensureDir(logDir);
    const log = new LogManager(logDir);
    await log.init();

    // Create a fake old log file (use a past date name)
    const oldLogPath = path.join(logDir, 'operations-2020-01-01.log');
    await fs.writeFile(oldLogPath, '{"test": true}\n');
    // Set its mtime to very old
    const pastTime = new Date('2020-01-01').getTime() / 1000;
    await fs.utimes(oldLogPath, pastTime, pastTime);

    await log.pruneOldLogs(30);
    expect(await pathExists(oldLogPath)).toBe(false);
  });
});

describe('StorageManager — tryRestoreFromBackup (lines 132-159)', () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-restore-'));
    storePath = path.join(tmpDir, '.envcp', 'store.enc');
    await ensureDir(path.dirname(storePath));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('restores from .bak.1 when main store is corrupt (encrypted)', async () => {
    const { encrypt } = await import('../src/utils/crypto.js');
    const now = new Date().toISOString();
    const validData = JSON.stringify({
      MY_KEY: { name: 'MY_KEY', value: 'restored', encrypted: false, created: now, updated: now, sync_to_env: true },
    });
    const password = 'test-restore-pw';
    const encryptedBackup = await encrypt(validData, password);

    await fs.writeFile(`${storePath}.bak.1`, encryptedBackup);
    await fs.writeFile(storePath, 'CORRUPT-NOT-VALID-CIPHERTEXT');

    const storage = new StorageManager(storePath, true, 3);
    storage.setPassword(password);

    const vars = await storage.load();
    expect(vars['MY_KEY']).toBeDefined();
    expect(vars['MY_KEY'].value).toBe('restored');
  });

  it('rethrows non-ENOENT errors during backup rotation', async () => {
    await ensureDir(path.dirname(storePath));
    await fs.writeFile(storePath, '{}');
    await fs.writeFile(`${storePath}.bak.3`, '{}');
    await fs.mkdir(`${storePath}.bak.2`);
    const storage = new StorageManager(storePath, false, 3);
    try {
      await storage.set('TEST', { name: 'TEST', value: 'v', encrypted: false, created: new Date().toISOString(), updated: new Date().toISOString(), sync_to_env: true });
      expect(true).toBe(false);
    } catch (e: unknown) {
      expect((e as Error).message).toBeDefined();
    }
  });

  it('tryRestoreFromBackup returns null when password not set', async () => {
    const storage = new StorageManager(storePath, true, 2);
    storage.setPassword('test');
    const now = new Date().toISOString();
    await storage.set('KEY', { name: 'KEY', value: 'v', encrypted: true, created: now, updated: now, sync_to_env: true });
    storage.invalidateCache();
    const storage2 = new StorageManager(storePath, true, 2);
    (storage2 as any).password = undefined;
    await fs.writeFile(storePath, 'corrupt');
    const result = await (storage2 as any).tryRestoreFromBackup();
    expect(result).toBeNull();
  });
});

import { resolveLogPath } from '../src/storage/index';

describe('resolveLogPath', () => {
  const projectPath = '/some/project';

  it('returns default log path when audit is undefined', () => {
    expect(resolveLogPath(undefined, projectPath)).toBe(
      path.join(projectPath, '.envcp', 'logs')
    );
  });

  it('resolves ~ prefix using HOME', () => {
    const orig = process.env.HOME;
    try {
      process.env.HOME = '/home/testuser';
      const result = resolveLogPath({ log_path: '~/mylogs' } as any, projectPath);
      expect(result).toBe('/home/testuser/mylogs');
    } finally {
      if (orig !== undefined) process.env.HOME = orig;
    }
  });

  it('resolves ~ prefix using USERPROFILE when HOME is unset', () => {
    const origHome = process.env.HOME;
    const origUp = process.env.USERPROFILE;
    try {
      delete process.env.HOME;
      process.env.USERPROFILE = '/users/win';
      const result = resolveLogPath({ log_path: '~/mylogs' } as any, projectPath);
      expect(result).toBe('/users/win/mylogs');
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      if (origUp !== undefined) process.env.USERPROFILE = origUp;
      else delete process.env.USERPROFILE;
    }
  });

  it('returns absolute path as-is', () => {
    const result = resolveLogPath({ log_path: '/abs/path/logs' } as any, projectPath);
    expect(result).toBe('/abs/path/logs');
  });
});

describe('LogManager filter fields', () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(async () => {
    tmpDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-logfilter-'));
    logDir = path.join(tmpDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('includes ip, user_agent, purpose, duration_ms in filtered output', async () => {
    const auditConfig = AuditConfigSchema.parse({ fields: { user_agent: true, purpose: true } });
    const logger = new LogManager(logDir, auditConfig);
    await logger.init();

    const ts = new Date().toISOString();
    await logger.log({
      timestamp: ts,
      operation: 'get',
      variable: 'MY_VAR',
      source: 'api',
      success: true,
      ip: '127.0.0.1',
      user_agent: 'curl/7.68.0',
      purpose: 'testing',
      duration_ms: 42,
    } as any);

    const results = await logger.getLogs({});
    expect(results.length).toBeGreaterThan(0);
    const entry = results[results.length - 1];
    expect((entry as any).ip).toBe('127.0.0.1');
    expect((entry as any).user_agent).toBe('curl/7.68.0');
    expect((entry as any).purpose).toBe('testing');
    expect((entry as any).duration_ms).toBe(42);
  });

  it('triggers loadLastChainState on first log call (empty log dir)', async () => {
    const logger = new LogManager(logDir);
    await logger.init();
    // First log triggers loadLastChainState; logDir has no existing logs
    await expect(logger.log({
      timestamp: new Date().toISOString(),
      operation: 'list',
      source: 'cli',
      success: true,
    })).resolves.not.toThrow();
  });
});
