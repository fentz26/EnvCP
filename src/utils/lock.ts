import * as fs from 'fs/promises';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 50;

/**
 * Acquires an exclusive lock on `filePath` using an atomic `.lock` sentinel file,
 * runs `fn`, then releases the lock. Retries up to MAX_RETRIES times with
 * linear back-off before throwing.
 *
 * Uses O_CREAT|O_EXCL (the `wx` flag) which is atomic on POSIX and NTFS —
 * the same primitive proper-lockfile uses internally.
 */
export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = filePath + '.lock';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.close();
      break; // lock acquired
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (attempt === MAX_RETRIES) {
        throw new Error(`Could not acquire lock for ${filePath} after ${MAX_RETRIES} retries`);
      }
      await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS * (attempt + 1)));
    }
  }

  try {
    return await fn();
  } finally {
    try { await fs.unlink(lockPath); } catch { /* ignore: lock file already gone */ }
  }
}
