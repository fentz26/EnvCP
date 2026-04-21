import * as fs from 'node:fs';
import * as nodefs from 'node:fs/promises';
import * as path from 'node:path';
import { withLock } from './lock.js';
import { ensureDir } from './fs.js';
import { Session, SessionSchema } from '../types.js';
import { generateId, encrypt, decrypt } from './crypto.js';
import { passwordToBuffer, bufferToString, secureZero, SecureBuffer } from './secure-memory.js';

export class SessionManager {
  private readonly sessionPath: string;
  private session: Session | null = null;
  private passwordBuf: SecureBuffer | null = null;
  private readonly timeoutMinutes: number;
  private readonly maxExtensions: number;

  constructor(sessionPath: string, timeoutMinutes: number = 30, maxExtensions: number = 5) {
    this.sessionPath = sessionPath;
    this.timeoutMinutes = timeoutMinutes;
    this.maxExtensions = maxExtensions;
  }

  async init(): Promise<void> {
    await ensureDir(path.dirname(this.sessionPath));
  }

  async create(password: string): Promise<Session> {
    const now = new Date();
    const expires = new Date(now.getTime() + this.timeoutMinutes * 60 * 1000);

    this.session = {
      id: generateId(),
      created: now.toISOString(),
      expires: expires.toISOString(),
      extensions: 0,
      last_access: now.toISOString(),
    };

    this.setPasswordBuf(password);

  const sessionData = JSON.stringify({
    session: this.session,
  });

  const encrypted = await encrypt(sessionData, this.passwordBuf!);
  await withLock(this.sessionPath, async () => {
    const wh = await nodefs.open(this.sessionPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
      0o600);
    try { await wh.writeFile(encrypted, 'utf8'); } finally { await wh.close(); }
  });

    return this.session;
  }

  async load(password?: string): Promise<Session | null> {
    let encrypted: string;
    try {
      const handle = await nodefs.open(this.sessionPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
          return null;
        }
        encrypted = await handle.readFile({ encoding: 'utf8' });
      } finally {
        await handle.close();
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }

    let transientPasswordInput: SecureBuffer | null = null;
    if (password) {
      transientPasswordInput = passwordToBuffer(password);
    }
    const passwordInput = transientPasswordInput ?? this.passwordBuf;
    if (!passwordInput) {
      return null;
    }

    let result: Session | null = null;
    try {
      const decrypted = await decrypt(encrypted, passwordInput);
      const data = JSON.parse(decrypted);
      this.session = SessionSchema.parse(data.session);
      // Password is verified by successful decryption — no longer stored in file
      if (password) {
        this.setPasswordBuf(password);
      }

      if (new Date() > new Date(this.session.expires)) {
        await this.destroy();
      } else {
        result = this.session;
      }
    } catch {
      result = null;
    }

    if (transientPasswordInput) {
      secureZero(transientPasswordInput);
    }

    return result;
  }

  async isValid(): Promise<boolean> {
    if (!this.session) {
      return false;
    }
    
    return new Date() < new Date(this.session.expires);
  }

  async extend(): Promise<Session | null> {
    if (!this.session || !this.passwordBuf) {
      return null;
    }

    if (this.session.extensions >= this.maxExtensions) {
      return null;
    }

    if (!await this.isValid()) {
      return null;
    }

    const now = new Date();
    const expires = new Date(now.getTime() + this.timeoutMinutes * 60 * 1000);

    this.session.expires = expires.toISOString();
    this.session.extensions += 1;
    this.session.last_access = now.toISOString();

    const sessionData = JSON.stringify({
      session: this.session,
    });

    const encrypted = await encrypt(sessionData, this.passwordBuf);
  await withLock(this.sessionPath, async () => {
    const wh = await nodefs.open(this.sessionPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
      0o600);
    try { await wh.writeFile(encrypted, 'utf8'); } finally { await wh.close(); }
  });

    return this.session;
  }

  async destroy(): Promise<void> {
    this.session = null;
    this.clearPasswordBuf();

    try {
      await nodefs.unlink(this.sessionPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  getPassword(): string | null {
    return this.passwordBuf ? bufferToString(this.passwordBuf) : null;
  }

  private setPasswordBuf(password: string): void {
    this.clearPasswordBuf();
    this.passwordBuf = passwordToBuffer(password);
  }

  private clearPasswordBuf(): void {
    if (this.passwordBuf) {
      secureZero(this.passwordBuf);
      this.passwordBuf = null;
    }
  }

  getSession(): Session | null {
    return this.session;
  }

  getRemainingTime(): number {
    if (!this.session) {
      return 0;
    }
    
    const remaining = new Date(this.session.expires).getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000 / 60));
  }
}
