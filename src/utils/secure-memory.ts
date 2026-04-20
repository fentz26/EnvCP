import * as sodium from 'sodium-native';
import * as nodeCrypto from 'crypto';
import * as childProcess from 'child_process';

const HAS_SODIUM = typeof sodium.sodium_malloc === 'function';

export type SecureBuffer = Buffer & { _secure?: boolean };

export function secureAlloc(size: number): SecureBuffer {
  if (HAS_SODIUM) {
    return sodium.sodium_malloc(size) as SecureBuffer;
  }
  const buf = Buffer.alloc(size) as SecureBuffer;
  buf._secure = false;
  return buf;
}

export function secureFree(buf: Buffer): void {
  if (!buf || buf.length === 0) return;
  secureZero(buf);
}

export function secureZero(buf: Buffer): void {
  if (!buf || buf.length === 0) return;
  if (HAS_SODIUM) {
    sodium.sodium_memzero(buf);
  } else {
    buf.fill(0);
  }
}

export function lockMemory(buf: Buffer): boolean {
  if (!HAS_SODIUM) return false;
  try {
    sodium.sodium_mlock(buf);
    return true;
  } catch {
    return false;
  }
}

export function unlockMemory(buf: Buffer): void {
  if (!HAS_SODIUM) return;
  try { sodium.sodium_munlock(buf); } catch { /* ignore */ }
}

export function passwordToBuffer(password: string): SecureBuffer {
  const len = Buffer.byteLength(password, 'utf8');
  const buf = secureAlloc(len);
  buf.write(password, 'utf8');
  return buf;
}

export function bufferToString(buf: Buffer): string {
  return buf.toString('utf8');
}

export function secureCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  try {
    return nodeCrypto.timingSafeEqual(a, b);
  } catch {
    let result = 0;
    for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
    return result === 0;
  }
}

export function zeroObjectValues(obj: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    const val = obj[key];
    if (Buffer.isBuffer(val)) secureZero(val);
    obj[key] = undefined;
  }
}

export function zeroEnv(env: Record<string, string | undefined>, keys: string[]): void {
  for (const key of keys) {
    delete env[key];
  }
}

export function isDebuggerAttached(): boolean {
  /* c8 ignore next -- non-linux platforms always return false; tests run on linux */
  if (process.platform !== 'linux') return false;
  try {
    /* c8 ignore next 3 */
    const fs = require('fs') as typeof import('fs');
    const status = fs.readFileSync('/proc/self/status', 'utf8');
    const match = status.match(/TracerPid:\s*(\d+)/);
    /* c8 ignore next */
    return match != null && match[1] !== '0';
  } catch {
    return false;
  }
}

export function preventCoreDumps(): boolean {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return false;
  try {
    childProcess.execSync(`prlimit --core=0 --pid=${process.pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    try {
      childProcess.execSync('ulimit -c 0', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

let memoryProtectionInitialized = false;

export function initMemoryProtection(): { coreDumpsDisabled: boolean; debuggerDetected: boolean } {
  const result = { coreDumpsDisabled: false, debuggerDetected: false };
  if (memoryProtectionInitialized) return result;
  memoryProtectionInitialized = true;

  result.debuggerDetected = isDebuggerAttached();
  result.coreDumpsDisabled = preventCoreDumps();
  return result;
}
