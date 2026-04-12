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
});
