import * as fs from 'fs';
import * as nodefs from 'fs/promises';
import * as path from 'path';
import { withLock } from './lock.js';
import { ensureDir, pathExists } from './fs.js';
import { Session, SessionSchema } from '../types.js';
import { generateId, encrypt, decrypt } from './crypto.js';

export class SessionManager {
  private sessionPath: string;
  private session: Session | null = null;
  private password: string | null = null;
  private timeoutMinutes: number;
  private maxExtensions: number;

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

  this.password = password;

  const sessionData = JSON.stringify({
    session: this.session,
  });

  const encrypted = await encrypt(sessionData, password);
  await nodefs.writeFile(this.sessionPath, '', { encoding: 'utf8', mode: 0o600, flag: 'a' });
  await withLock(this.sessionPath, async () => {
    await nodefs.writeFile(this.sessionPath, encrypted, { encoding: 'utf8', mode: 0o600 });
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

    try {
      
      const pwd = password || this.password;
      if (!pwd) {
        return null;
      }

      const decrypted = await decrypt(encrypted, pwd);
      const data = JSON.parse(decrypted);
      this.session = SessionSchema.parse(data.session);
      // Password is verified by successful decryption — no longer stored in file
      this.password = pwd;
      
      if (new Date() > new Date(this.session.expires)) {
        await this.destroy();
        return null;
      }
      
      return this.session;
    } catch (error) {
      return null;
    }
  }

  async isValid(): Promise<boolean> {
    if (!this.session) {
      return false;
    }
    
    return new Date() < new Date(this.session.expires);
  }

  async extend(): Promise<Session | null> {
    if (!this.session || !this.password) {
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

  const encrypted = await encrypt(sessionData, this.password);
  await nodefs.writeFile(this.sessionPath, '', { encoding: 'utf8', mode: 0o600, flag: 'a' });
  await withLock(this.sessionPath, async () => {
    await nodefs.writeFile(this.sessionPath, encrypted, { encoding: 'utf8', mode: 0o600 });
  });

    return this.session;
  }

  async destroy(): Promise<void> {
    this.session = null;
    this.password = null;

    try {
      await nodefs.unlink(this.sessionPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  getPassword(): string | null {
    return this.password;
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
