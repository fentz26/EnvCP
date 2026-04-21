import * as fs from 'node:fs/promises';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 50;
const MAX_DELAY_MS = 1000;

/**
 * Acquires an exclusive lock on `filePath` using an atomic `.lock` sentinel file,
 * runs `fn`, then releases the lock. Retries up to MAX_RETRIES times with
 * exponential back-off + jitter before throwing.
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
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** attempt)) + Math.random() * 50;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  try {
    return await fn();
  } finally {
    /* c8 ignore next -- lock file may already be gone; error is intentionally swallowed */
    try { await fs.unlink(lockPath); } catch { /* ignore: lock file already gone */ }
  }
}
