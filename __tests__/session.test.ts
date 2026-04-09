import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { SessionManager } from '../src/utils/session';

describe('SessionManager', () => {
  let tmpDir: string;
  let sessionPath: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-session-test-'));
    sessionPath = path.join(tmpDir, '.session');
    manager = new SessionManager(sessionPath, 30, 5);
    await manager.init();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('creates a session successfully', async () => {
    const session = await manager.create('test-password');

    expect(session).toBeDefined();
    expect(session.id).toMatch(/^[a-f0-9]{32}$/);
    expect(session.extensions).toBe(0);
    expect(new Date(session.expires) > new Date()).toBe(true);
  });

  it('persists session to disk', async () => {
    await manager.create('my-secret');

    expect(await fs.pathExists(sessionPath)).toBe(true);
  });

  it('loads a session with correct password', async () => {
    const created = await manager.create('my-password');

    const manager2 = new SessionManager(sessionPath, 30, 5);
    await manager2.init();

    const loaded = await manager2.load('my-password');

    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(created.id);
  });

  it('returns null when loading with wrong password', async () => {
    await manager.create('correct-password');

    const manager2 = new SessionManager(sessionPath, 30, 5);
    await manager2.init();

    const loaded = await manager2.load('wrong-password');
    expect(loaded).toBeNull();
  });

  it('returns null when no session file exists', async () => {
    const loaded = await manager.load('any-password');
    expect(loaded).toBeNull();
  });

  it('isValid returns false when no session exists', async () => {
    expect(await manager.isValid()).toBe(false);
  });

  it('isValid returns true for a freshly created session', async () => {
    await manager.create('password');
    expect(await manager.isValid()).toBe(true);
  });

  it('extends a session and increments extension count', async () => {
    const original = await manager.create('password');
    const extended = await manager.extend();

    expect(extended).toBeDefined();
    expect(extended!.extensions).toBe(1);
    expect(extended!.id).toBe(original.id);
  });

  it('returns null on extend when max extensions reached', async () => {
    const mgr = new SessionManager(sessionPath, 30, 2);
    await mgr.init();
    await mgr.create('password');

    await mgr.extend(); // 1
    await mgr.extend(); // 2
    const result = await mgr.extend(); // should fail

    expect(result).toBeNull();
  });

  it('destroys the session and removes the file', async () => {
    await manager.create('password');
    expect(await fs.pathExists(sessionPath)).toBe(true);

    await manager.destroy();

    expect(await fs.pathExists(sessionPath)).toBe(false);
    expect(await manager.isValid()).toBe(false);
    expect(manager.getSession()).toBeNull();
  });

  it('getPassword returns null before a session is created', () => {
    expect(manager.getPassword()).toBeNull();
  });

  it('getPassword returns the session password', async () => {
    await manager.create('my-password');
    expect(manager.getPassword()).toBe('my-password');
  });

  it('getRemainingTime returns 0 when no session', () => {
    expect(manager.getRemainingTime()).toBe(0);
  });

  it('getRemainingTime returns positive minutes for a fresh session', async () => {
    await manager.create('password');
    const remaining = manager.getRemainingTime();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30);
  });

  it('handles loading from a directory path gracefully', async () => {
    // Create a directory where the session file would be
    const dirSessionPath = path.join(tmpDir, 'dir-session');
    await fs.ensureDir(dirSessionPath);

    const mgr = new SessionManager(dirSessionPath, 30, 5);
    await mgr.init();

    const result = await mgr.load('password');
    expect(result).toBeNull();
  });

  it('returns null on extend when no session has been created', async () => {
    const result = await manager.extend();
    expect(result).toBeNull();
  });
});
