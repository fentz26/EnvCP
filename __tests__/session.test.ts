import * as path from 'path';
import * as os from 'os';
import * as nativeFs from 'fs';
import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import { SessionManager } from '../src/utils/session';

const makeTmpDir = () => nativeFs.mkdtempSync(path.join(os.tmpdir(), 'envcp-session-test-'));

describe('SessionManager', () => {
  let dir: string;
  let sessionPath: string;
  let manager: SessionManager;

  beforeEach(async () => {
    dir = makeTmpDir();
    sessionPath = path.join(dir, '.session');
    manager = new SessionManager(sessionPath, 30, 5);
    await manager.init();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates a session and returns it', async () => {
    const session = await manager.create('password123');
    expect(session).toBeTruthy();
    expect(session.id).toHaveLength(32);
    expect(session.extensions).toBe(0);
    expect(new Date(session.expires) > new Date()).toBe(true);
  });

  it('session file is created on disk', async () => {
    await manager.create('password123');
    expect(await pathExists(sessionPath)).toBe(true);
  });

  it('loads a valid session with correct password', async () => {
    await manager.create('password123');
    const m2 = new SessionManager(sessionPath, 30, 5);
    await m2.init();
    const loaded = await m2.load('password123');
    expect(loaded).toBeTruthy();
    expect(loaded!.extensions).toBe(0);
  });

  it('returns null when loading with wrong password', async () => {
    await manager.create('password123');
    const m2 = new SessionManager(sessionPath, 30, 5);
    await m2.init();
    const loaded = await m2.load('wrongpassword');
    expect(loaded).toBeNull();
  });

  it('returns null when no session file exists', async () => {
    const loaded = await manager.load('password123');
    expect(loaded).toBeNull();
  });

  it('isValid returns true for active session', async () => {
    await manager.create('password123');
    expect(await manager.isValid()).toBe(true);
  });

  it('isValid returns false when no session loaded', async () => {
    expect(await manager.isValid()).toBe(false);
  });

  it('extends session and increments extensions counter', async () => {
    await manager.create('password123');
    const extended = await manager.extend();
    expect(extended).toBeTruthy();
    expect(extended!.extensions).toBe(1);
  });

  it('extend returns null when max extensions reached', async () => {
    const m = new SessionManager(sessionPath, 30, 2);
    await m.init();
    await m.create('password123');
    await m.extend();
    await m.extend();
    const result = await m.extend();
    expect(result).toBeNull();
  });

  it('getRemainingTime returns positive minutes for active session', async () => {
    await manager.create('password123');
    const remaining = manager.getRemainingTime();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30);
  });

  it('getRemainingTime returns 0 when no session', () => {
    expect(manager.getRemainingTime()).toBe(0);
  });

  it('destroy removes session file and clears state', async () => {
    await manager.create('password123');
    await manager.destroy();
    expect(await pathExists(sessionPath)).toBe(false);
    expect(manager.getSession()).toBeNull();
    expect(manager.getPassword()).toBeNull();
  });

  it('getPassword returns password after create', async () => {
    await manager.create('mypassword');
    expect(manager.getPassword()).toBe('mypassword');
  });

  it('rejects symlink at session path', async () => {
    const target = path.join(dir, 'target.txt');
    await fs.writeFile(target, 'real file');
    await fs.symlink(target, sessionPath);
    const loaded = await manager.load('password123');
    expect(loaded).toBeNull();
  });

  it('load returns null when no password available', async () => {
    await manager.create('password123');
    const m2 = new SessionManager(sessionPath, 30, 5);
    await m2.init();
    // Load without password and without cached password
    const loaded = await m2.load();
    expect(loaded).toBeNull();
  });

  it('load reuses cached password when one is already stored in memory', async () => {
    await manager.create('password123');
    const loaded = await manager.load();
    expect(loaded).toBeTruthy();
    expect(loaded!.extensions).toBe(0);
  });

  it('load returns null for expired session', async () => {
    // Create session with 0 minute timeout (immediately expired)
    const m = new SessionManager(sessionPath, 0, 5);
    await m.init();
    await m.create('password123');
    // Load with new manager to force re-read
    const m2 = new SessionManager(sessionPath, 0, 5);
    await m2.init();
    const loaded = await m2.load('password123');
    expect(loaded).toBeNull();
  });

  it('extend returns null when no session loaded', async () => {
    const result = await manager.extend();
    expect(result).toBeNull();
  });

  it('destroy is idempotent (no error on missing file)', async () => {
    await manager.destroy();
    // No error thrown
    expect(manager.getSession()).toBeNull();
  });

  it('load returns null for non-regular file (directory)', async () => {
    // Create a directory at the session path to trigger non-ENOENT but also non-file
    await ensureDir(sessionPath);
    const loaded = await manager.load('password123');
    expect(loaded).toBeNull();
  });

  it('extend returns null when session is expired', async () => {
    const m = new SessionManager(sessionPath, 0, 5);
    await m.init();
    await m.create('password123');
    const result = await m.extend();
    expect(result).toBeNull();
  });

  it('uses default constructor params', async () => {
    const m = new SessionManager(sessionPath);
    await m.init();
    const session = await m.create('password123');
    expect(new Date(session.expires).getTime() - new Date(session.created).getTime()).toBe(30 * 60 * 1000);
  });

  it('destroy re-throws non-ENOENT errors', async () => {
    const m = new SessionManager('/proc/1/mem');
    await expect(m.destroy()).rejects.toThrow();
  });
});
