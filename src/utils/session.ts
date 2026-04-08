import * as fs from 'fs-extra';
import * as path from 'path';
import { Session, SessionSchema } from '../types.js';
import { generateId, encrypt, decrypt } from './crypto.js';
import * as crypto from 'crypto';

const PBKDF2_ITERATIONS = 100000;

function hashPassword(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha512');
}

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
    await fs.ensureDir(path.dirname(this.sessionPath));
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

  const salt = crypto.randomBytes(32);
  const passwordHash = hashPassword(password, salt);
  const sessionData = JSON.stringify({
    session: this.session,
    passwordHash: passwordHash.toString('hex'),
    salt: salt.toString('hex'),
  });

    const encrypted = encrypt(sessionData, password);
    await fs.writeFile(this.sessionPath, encrypted, 'utf8');

    return this.session;
  }

  async load(password?: string): Promise<Session | null> {
    if (!await fs.pathExists(this.sessionPath)) {
      return null;
    }

    try {
      const encrypted = await fs.readFile(this.sessionPath, 'utf8');
      
      const pwd = password || this.password;
      if (!pwd) {
        return null;
      }

      const decrypted = decrypt(encrypted, pwd);
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

  const salt = crypto.randomBytes(32);
  const passwordHash = hashPassword(this.password, salt);
  const sessionData = JSON.stringify({
    session: this.session,
    passwordHash: passwordHash.toString('hex'),
    salt: salt.toString('hex'),
  });

    const encrypted = encrypt(sessionData, this.password);
    await fs.writeFile(this.sessionPath, encrypted, 'utf8');

    return this.session;
  }

  async destroy(): Promise<void> {
    this.session = null;
    this.password = null;
    
    if (await fs.pathExists(this.sessionPath)) {
      await fs.unlink(this.sessionPath);
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
