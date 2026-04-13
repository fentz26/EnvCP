import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { LockoutManager } from '../src/utils/lockout';

const makeTmpDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'envcp-lockout-'));

describe('LockoutManager', () => {
  let dir: string;
  let lockoutPath: string;
  let manager: LockoutManager;

  beforeEach(async () => {
    dir = await makeTmpDir();
    lockoutPath = path.join(dir, '.lockout');
    manager = new LockoutManager(lockoutPath);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns not locked with 0 attempts when no file exists', async () => {
    const status = await manager.check();
    expect(status.locked).toBe(false);
    expect(status.attempts).toBe(0);
    expect(status.remaining_seconds).toBe(0);
  });

  it('increments attempt counter on each failure', async () => {
    await manager.recordFailure(5, 60);
    await manager.recordFailure(5, 60);
    const status = await manager.check();
    expect(status.attempts).toBe(2);
    expect(status.locked).toBe(false);
  });

  it('imposes lockout when threshold is reached', async () => {
    for (let i = 0; i < 5; i++) {
      await manager.recordFailure(5, 60);
    }
    const status = await manager.check();
    expect(status.locked).toBe(true);
    expect(status.remaining_seconds).toBeGreaterThan(0);
    expect(status.remaining_seconds).toBeLessThanOrEqual(60);
  });

  it('recordFailure returns locked=true and cooldown on threshold hit', async () => {
    for (let i = 0; i < 4; i++) await manager.recordFailure(5, 60);
    const result = await manager.recordFailure(5, 60);
    expect(result.locked).toBe(true);
    expect(result.remaining_seconds).toBe(60);
  });

  it('doubles cooldown on second lockout (exponential backoff)', async () => {
    // First lockout: base seconds (60s)
    for (let i = 0; i < 5; i++) await manager.recordFailure(5, 60);
    const first = await manager.check();
    expect(first.remaining_seconds).toBeLessThanOrEqual(60);

    // Simulate lockout expired by overwriting locked_until with past timestamp
    const data = JSON.parse(await fs.readFile(lockoutPath, 'utf8'));
    data.locked_until = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(lockoutPath, JSON.stringify(data));

    // Second lockout: 120s (60 * 2^1)
    for (let i = 0; i < 5; i++) await manager.recordFailure(5, 60);
    const second = await manager.check();
    expect(second.remaining_seconds).toBeLessThanOrEqual(120);
    expect(second.remaining_seconds).toBeGreaterThan(60);
  });

  it('reset removes the lockout file', async () => {
    await manager.recordFailure(5, 60);
    await manager.reset();
    const status = await manager.check();
    expect(status.locked).toBe(false);
    expect(status.attempts).toBe(0);
  });

  it('reset is idempotent when no file exists', async () => {
    await expect(manager.reset()).resolves.not.toThrow();
  });

  it('returns not locked after lockout period expires', async () => {
    // Write a lockout that expired 1 second ago
    await fs.mkdir(path.dirname(lockoutPath), { recursive: true });
    await fs.writeFile(lockoutPath, JSON.stringify({
      attempts: 0,
      lockout_count: 1,
      locked_until: new Date(Date.now() - 1000).toISOString(),
    }));
    const status = await manager.check();
    expect(status.locked).toBe(false);
  });

  it('clears locked_until after expiry and preserves lockout_count', async () => {
    await fs.mkdir(path.dirname(lockoutPath), { recursive: true });
    await fs.writeFile(lockoutPath, JSON.stringify({
      attempts: 0,
      lockout_count: 2,
      locked_until: new Date(Date.now() - 1000).toISOString(),
    }));
    await manager.check(); // triggers expiry clear
    // Next lockout should use lockout_count=2 → 60 * 2^2 = 240s
    for (let i = 0; i < 5; i++) await manager.recordFailure(5, 60);
    const status = await manager.check();
    expect(status.remaining_seconds).toBeLessThanOrEqual(240);
    expect(status.remaining_seconds).toBeGreaterThan(120);
  });

  it('threshold=1 locks on first failure', async () => {
    const result = await manager.recordFailure(1, 30);
    expect(result.locked).toBe(true);
    expect(result.remaining_seconds).toBe(30);
  });

  it('recordFailure uses default threshold and baseSeconds when called without args', async () => {
    // Call with no args to hit default parameter branches (threshold=5, baseSeconds=60)
    for (let i = 0; i < 4; i++) {
      await manager.recordFailure();
    }
    const result = await manager.recordFailure(); // 5th attempt → lockout
    expect(result.locked).toBe(true);
    expect(result.remaining_seconds).toBe(60); // baseSeconds default
  });

  it('reset() silently ignores ENOENT when lockout file does not exist', async () => {
    // No file exists — should not throw
    await expect(manager.reset()).resolves.toBeUndefined();
  });

  it('reset() rethrows errors that are not ENOENT', async () => {
    // Put a directory at the lockoutPath — unlink on a directory throws EISDIR (not ENOENT)
    // so the catch block should rethrow rather than silently ignore it
    await fs.mkdir(lockoutPath, { recursive: true });
    await expect(manager.reset()).rejects.toThrow();
    // Cleanup: remove the directory we just created
    await fs.rmdir(lockoutPath);
  });

  it('applies progressive delays when enabled', async () => {
    // Test with progressive delay: 1s, 2s, 4s, 8s (capped at maxDelay)
    // Use threshold=10 so we don't trigger lockout
    const result1 = await manager.recordFailure(10, 60, true, 10, 0);
    expect(result1.delay_seconds).toBe(1); // 2^0 = 1
    
    const result2 = await manager.recordFailure(10, 60, true, 10, 0);
    expect(result2.delay_seconds).toBe(2); // 2^1 = 2
    
    const result3 = await manager.recordFailure(10, 60, true, 10, 0);
    expect(result3.delay_seconds).toBe(4); // 2^2 = 4
    
    const result4 = await manager.recordFailure(10, 60, true, 10, 0);
    expect(result4.delay_seconds).toBe(8); // 2^3 = 8
    
    // Next should be 16 but capped at maxDelay=10
    const result5 = await manager.recordFailure(10, 60, true, 10, 0);
    expect(result5.delay_seconds).toBe(10); // capped
  });

  it('does not apply progressive delays when disabled', async () => {
    const result = await manager.recordFailure(5, 60, false, 10, 0);
    expect(result.delay_seconds).toBeUndefined();
  });

  it('triggers permanent lockout after threshold', async () => {
    // Set permanent threshold to 2 lockouts
    for (let lockout = 0; lockout < 2; lockout++) {
      // Trigger lockout (5 attempts each)
      for (let i = 0; i < 5; i++) {
        await manager.recordFailure(5, 60, false, 0, 2);
      }
      // Simulate lockout expiry
      const data = JSON.parse(await fs.readFile(lockoutPath, 'utf8'));
      data.locked_until = new Date(Date.now() - 1000).toISOString();
      await fs.writeFile(lockoutPath, JSON.stringify(data));
    }
    
    // Next lockout should trigger permanent lockout
    for (let i = 0; i < 5; i++) {
      await manager.recordFailure(5, 60, false, 0, 2);
    }
    
    const status = await manager.check();
    expect(status.permanent_locked).toBe(true);
  });

  it('check() returns permanent_locked status', async () => {
    // Create permanent lockout directly
    await fs.mkdir(path.dirname(lockoutPath), { recursive: true });
    await fs.writeFile(lockoutPath, JSON.stringify({
      attempts: 0,
      lockout_count: 3,
      permanent_lockout_count: 3,
      locked_until: null,
      permanent_locked: true
    }));
    
    const status = await manager.check();
    expect(status.locked).toBe(true);
    expect(status.permanent_locked).toBe(true);
    expect(status.remaining_seconds).toBe(0);
  });

  it('clearPermanentLockout() removes permanent lockout', async () => {
    // Create permanent lockout
    await fs.mkdir(path.dirname(lockoutPath), { recursive: true });
    await fs.writeFile(lockoutPath, JSON.stringify({
      attempts: 0,
      lockout_count: 3,
      permanent_lockout_count: 3,
      locked_until: null,
      permanent_locked: true
    }));
    
    await manager.clearPermanentLockout();
    const status = await manager.check();
    expect(status.permanent_locked).toBe(false);
    expect(status.lockout_count).toBe(3); // Should preserve lockout_count
  });

  it('getStats() returns detailed statistics', async () => {
    await manager.recordFailure(5, 60, true, 10, 50);
    await manager.recordFailure(5, 60, true, 10, 50);
    
    const stats = await manager.getStats();
    expect(stats.attempts).toBe(2);
    expect(stats.lockout_count).toBe(0);
    expect(stats.permanent_lockout_count).toBe(0);
    expect(stats.permanent_locked).toBe(false);
    expect(stats.locked_until).toBeNull();
  });

  it('recordFailure() handles permanent lockout on first check', async () => {
    // Create permanent lockout
    await fs.mkdir(path.dirname(lockoutPath), { recursive: true });
    await fs.writeFile(lockoutPath, JSON.stringify({
      attempts: 0,
      lockout_count: 3,
      permanent_lockout_count: 50,
      locked_until: null,
      permanent_locked: true
    }));
    
    const result = await manager.recordFailure(5, 60, true, 10, 50);
    expect(result.permanent_locked).toBe(true);
    expect(result.locked).toBe(true);
  });
});
