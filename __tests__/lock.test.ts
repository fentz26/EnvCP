import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { withLock } from '../src/utils/lock';

describe('withLock', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-lock-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('acquires lock and runs fn', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'data');

    const result = await withLock(filePath, async () => {
      return 'success';
    });

    expect(result).toBe('success');
    // Lock file should be cleaned up
    await expect(fs.access(filePath + '.lock')).rejects.toThrow();
  });

  it('releases lock after fn throws', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'data');

    await expect(withLock(filePath, async () => {
      throw new Error('test error');
    })).rejects.toThrow('test error');

    // Lock file should still be cleaned up
    await expect(fs.access(filePath + '.lock')).rejects.toThrow();
  });

  it('retries when lock is held', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'data');

    const lockPath = filePath + '.lock';

    // Hold the lock
    const handle = await fs.open(lockPath, 'wx');
    await handle.close();

    // Release after a short delay
    setTimeout(async () => {
      await fs.unlink(lockPath);
    }, 100);

    const result = await withLock(filePath, async () => {
      return 'retried';
    });

    expect(result).toBe('retried');
  });

  it('throws after max retries', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'data');

    const lockPath = filePath + '.lock';

    // Hold the lock and never release
    const handle = await fs.open(lockPath, 'wx');
    await handle.close();

    await expect(withLock(filePath, async () => {
      return 'never';
    })).rejects.toThrow(/Could not acquire lock/);

    // Cleanup
    await fs.unlink(lockPath);
  });

  it('throws non-EEXIST errors immediately', async () => {
    const filePath = '/nonexistent/path/test.txt';

    await expect(withLock(filePath, async () => {
      return 'never';
    })).rejects.toThrow();
  });
});
