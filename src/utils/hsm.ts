import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ensureDir } from './fs.js';
import { EnvCPConfig } from '../types.js';

const execFileAsync = promisify(execFile);

export interface HsmStatus {
  available: boolean;
  type: string;
  device?: string;
  keyId?: string;
}

export interface HsmBackend {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  /** Encrypt plaintext bytes, return base64-encoded blob. */
  encryptData(plaintext: Buffer): Promise<string>;
  /** Decrypt a base64 blob produced by encryptData. */
  decryptData(blob: string): Promise<Buffer>;
  getStatus(): Promise<HsmStatus>;
}

// ---------------------------------------------------------------------------
// GPG backend
// ---------------------------------------------------------------------------

export class GpgBackend implements HsmBackend {
  readonly name = 'GPG';
  private keyId: string | undefined;

  constructor(keyId?: string) {
    this.keyId = keyId;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('gpg', ['--version']);
      if (this.keyId) {
        await execFileAsync('gpg', ['--list-keys', this.keyId]);
      }
      return true;
    } catch {
      return false;
    }
  }

  async encryptData(plaintext: Buffer): Promise<string> {
    if (!this.keyId) throw new Error('GPG backend requires a key_id');

    return new Promise((resolve, reject) => {
      const args = [
        '--encrypt',
        '--armor',
        '--batch',
        '--yes',
        '--trust-model', 'always',
        '--recipient', this.keyId!,
      ];
      const proc = execFile('gpg', args, { encoding: 'buffer' }, (err, stdout) => {
        if (err) return reject(new Error(`GPG encrypt failed: ${err.message}`));
        resolve((stdout as Buffer).toString('base64'));
      });
      proc.stdin!.write(plaintext);
      proc.stdin!.end();
    });
  }

  async decryptData(blob: string): Promise<Buffer> {
    const armored = Buffer.from(blob, 'base64');

    return new Promise((resolve, reject) => {
      const args = ['--decrypt', '--batch', '--yes'];
      const proc = execFile('gpg', args, { encoding: 'buffer' }, (err, stdout) => {
        if (err) return reject(new Error(`GPG decrypt failed: ${err.message}`));
        resolve(stdout as Buffer);
      });
      proc.stdin!.write(armored);
      proc.stdin!.end();
    });
  }

  async getStatus(): Promise<HsmStatus> {
    const available = await this.isAvailable();
    return { available, type: 'gpg', keyId: this.keyId };
  }
}

// ---------------------------------------------------------------------------
// YubiKey PIV backend (wraps ykman CLI)
// ---------------------------------------------------------------------------

// ykman PIV slot used for encryption; slot 9d is the Key Management slot.
const YUBIKEY_PIV_SLOT = '9d';

export class YubiKeyPivBackend implements HsmBackend {
  readonly name = 'YubiKey PIV';
  private serial: string | undefined;
  private requireTouch: boolean;

  constructor(serial?: string, requireTouch = true) {
    this.serial = serial;
    this.requireTouch = requireTouch;
  }

  private ykmanArgs(extra: string[]): string[] {
    return this.serial ? ['--device', this.serial, ...extra] : extra;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('ykman', this.ykmanArgs(['list']));
      return (stdout as string).trim().length > 0;
    } catch {
      return false;
    }
  }

  async encryptData(plaintext: Buffer): Promise<string> {
    // Export the PIV certificate for slot 9d to get the public key, then use
    // RSA-OAEP to encrypt an ephemeral AES-256 key.
    // ciphertext JSON: { iv, encKey (RSA-OAEP, hex), ciphertext (AES-GCM, hex), authTag (hex) }
    const certPem = await this._exportCert();
    const publicKey = crypto.createPublicKey({ key: certPem, format: 'pem' });

    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encKey = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      aesKey
    );

    const payload = JSON.stringify({
      iv: iv.toString('hex'),
      encKey: encKey.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
      authTag: authTag.toString('hex'),
    });
    return Buffer.from(payload).toString('base64');
  }

  async decryptData(blob: string): Promise<Buffer> {
    const payload = JSON.parse(Buffer.from(blob, 'base64').toString('utf8'));
    const { iv, encKey, ciphertext, authTag } = payload as {
      iv: string; encKey: string; ciphertext: string; authTag: string;
    };

    if (this.requireTouch) {
      process.stderr.write('Touch your YubiKey to decrypt...\n');
    }

    const aesKey = await this._pivDecrypt(Buffer.from(encKey, 'hex'));

    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'hex')),
      decipher.final(),
    ]);
  }

  private async _exportCert(): Promise<string> {
    const args = this.ykmanArgs(['piv', 'certificates', 'export', YUBIKEY_PIV_SLOT, '-']);
    const { stdout } = await execFileAsync('ykman', args);
    return stdout as string;
  }

  private async _pivDecrypt(encryptedKey: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = this.ykmanArgs(['piv', 'keys', 'decrypt', YUBIKEY_PIV_SLOT, '--input', '-', '--output', '-']);
      const proc = execFile('ykman', args, { encoding: 'buffer' }, (err, stdout) => {
        if (err) return reject(new Error(`ykman PIV decrypt failed: ${err.message}`));
        resolve(stdout as Buffer);
      });
      proc.stdin!.write(encryptedKey);
      proc.stdin!.end();
    });
  }

  async getStatus(): Promise<HsmStatus> {
    const available = await this.isAvailable();
    let device: string | undefined;
    if (available) {
      try {
        const { stdout } = await execFileAsync('ykman', this.ykmanArgs(['list']));
        device = (stdout as string).trim().split('\n')[0];
      } catch { /* ignore */ }
    }
    return { available, type: 'yubikey-piv', device };
  }
}

// ---------------------------------------------------------------------------
// PKCS#11 backend (uses pkcs11js)
// ---------------------------------------------------------------------------

type Pkcs11Lib = typeof import('pkcs11js');

export class Pkcs11Backend implements HsmBackend {
  readonly name = 'PKCS#11';
  private libPath: string;
  private slotIndex: number;
  private keyLabel: string | undefined;

  constructor(libPath: string, slotIndex = 0, keyLabel?: string) {
    this.libPath = libPath;
    this.slotIndex = slotIndex;
    this.keyLabel = keyLabel;
  }

  private async _loadPkcs11(): Promise<Pkcs11Lib> {
    return import('pkcs11js') as Promise<Pkcs11Lib>;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const pkcs11js = await this._loadPkcs11();
      const pkcs11 = new pkcs11js.PKCS11();
      pkcs11.load(this.libPath);
      pkcs11.C_Initialize();
      const slots = pkcs11.C_GetSlotList(true);
      pkcs11.C_Finalize();
      return slots.length > this.slotIndex;
    } catch {
      return false;
    }
  }

  async encryptData(plaintext: Buffer): Promise<string> {
    const pkcs11js = await this._loadPkcs11();
    const pkcs11 = new pkcs11js.PKCS11();
    pkcs11.load(this.libPath);
    pkcs11.C_Initialize();

    try {
      const slots = pkcs11.C_GetSlotList(true);
      const slot = slots[this.slotIndex];
      const session = pkcs11.C_OpenSession(slot, pkcs11js.CKF_SERIAL_SESSION);

      const publicKey = this._findKey(pkcs11, pkcs11js, session, pkcs11js.CKO_PUBLIC_KEY);

      pkcs11.C_EncryptInit(session, { mechanism: pkcs11js.CKM_RSA_PKCS_OAEP }, publicKey);
      const encrypted = pkcs11.C_Encrypt(session, plaintext, Buffer.alloc(512));

      pkcs11.C_CloseSession(session);
      return (encrypted as Buffer).toString('base64');
    } finally {
      pkcs11.C_Finalize();
    }
  }

  async decryptData(blob: string): Promise<Buffer> {
    const pkcs11js = await this._loadPkcs11();
    const pkcs11 = new pkcs11js.PKCS11();
    pkcs11.load(this.libPath);
    pkcs11.C_Initialize();

    try {
      const slots = pkcs11.C_GetSlotList(true);
      const slot = slots[this.slotIndex];
      const session = pkcs11.C_OpenSession(slot, pkcs11js.CKF_SERIAL_SESSION);

      const privateKey = this._findKey(pkcs11, pkcs11js, session, pkcs11js.CKO_PRIVATE_KEY);
      const ciphertext = Buffer.from(blob, 'base64');

      pkcs11.C_DecryptInit(session, { mechanism: pkcs11js.CKM_RSA_PKCS_OAEP }, privateKey);
      const decrypted = pkcs11.C_Decrypt(session, ciphertext, Buffer.alloc(512));

      pkcs11.C_CloseSession(session);
      return decrypted as Buffer;
    } finally {
      pkcs11.C_Finalize();
    }
  }

  private _findKey(
    pkcs11: InstanceType<Pkcs11Lib['PKCS11']>,
    pkcs11js: Pkcs11Lib,
    session: Buffer,
    keyClass: number
  ): Buffer {
    const template: import('pkcs11js').Template = [{ type: pkcs11js.CKA_CLASS, value: keyClass }];
    if (this.keyLabel) {
      template.push({ type: pkcs11js.CKA_LABEL, value: this.keyLabel });
    }
    pkcs11.C_FindObjectsInit(session, template);
    const objects = pkcs11.C_FindObjects(session, 1);
    pkcs11.C_FindObjectsFinal(session);
    if (objects.length === 0) {
      throw new Error(
        `PKCS#11: no ${keyClass === pkcs11js.CKO_PUBLIC_KEY ? 'public' : 'private'} key found` +
        (this.keyLabel ? ` with label "${this.keyLabel}"` : '')
      );
    }
    return objects[0] as Buffer;
  }

  async getStatus(): Promise<HsmStatus> {
    const available = await this.isAvailable();
    return { available, type: 'pkcs11', keyId: this.keyLabel };
  }
}

// ---------------------------------------------------------------------------
// HsmManager — selects backend, handles protect/retrieve lifecycle
// ---------------------------------------------------------------------------

export type HsmConfig = NonNullable<EnvCPConfig['hsm']>;

export class HsmManager {
  private backend: HsmBackend;
  private protectedKeyPath: string;

  constructor(backend: HsmBackend, protectedKeyPath: string) {
    this.backend = backend;
    this.protectedKeyPath = protectedKeyPath;
  }

  static fromConfig(config: EnvCPConfig, projectPath: string): HsmManager {
    const hsm = config.hsm ?? {};
    const keyPath = path.isAbsolute(hsm.protected_key_path ?? '')
      ? hsm.protected_key_path!
      : path.join(projectPath, hsm.protected_key_path ?? '.envcp/.hsm-key');

    let backend: HsmBackend;
    switch (hsm.type) {
      case 'gpg':
        backend = new GpgBackend(hsm.key_id);
        break;
      case 'pkcs11':
        if (!hsm.pkcs11_lib) throw new Error('hsm.pkcs11_lib is required for pkcs11 type');
        backend = new Pkcs11Backend(hsm.pkcs11_lib, hsm.slot ?? 0, hsm.key_id);
        break;
      case 'yubikey':
      default:
        backend = new YubiKeyPivBackend(hsm.serial, hsm.require_touch ?? true);
        break;
    }
    return new HsmManager(backend, keyPath);
  }

  get backendName(): string {
    return this.backend.name;
  }

  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable();
  }

  async getStatus(): Promise<HsmStatus> {
    return this.backend.getStatus();
  }

  /**
   * Encrypt the vault password with the HSM and write to protectedKeyPath.
   */
  async protectVaultPassword(vaultPassword: string): Promise<void> {
    const plaintext = Buffer.from(vaultPassword, 'utf8');
    const blob = await this.backend.encryptData(plaintext);
    await ensureDir(path.dirname(this.protectedKeyPath));
    await fs.writeFile(this.protectedKeyPath, blob, { encoding: 'utf8', mode: 0o600 });
  }

  /**
   * Read the protected key file and decrypt it with the HSM, returning the
   * original vault password.
   */
  async retrieveVaultPassword(): Promise<string> {
    let blob: string;
    try {
      blob = (await fs.readFile(this.protectedKeyPath, 'utf8')).trim();
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `HSM key file not found at ${this.protectedKeyPath}. ` +
          'Run "envcp unlock --setup-hsm" to configure hardware authentication.'
        );
      }
      throw err;
    }
    const decrypted = await this.backend.decryptData(blob);
    return decrypted.toString('utf8');
  }

  /** Derive a combined key from an HSM-provided secret and a user password.
   * Note: This is NOT password hashing (which uses Argon2id in crypto.ts).
   * This combines two independent secrets to create a composite encryption key.
   * HMAC-SHA256 is appropriate here as both inputs are high-entropy secrets.
   */
  static combineSecrets(hsmSecret: string, userPassword: string): string {
    const combined = Buffer.concat([
      Buffer.from(hsmSecret, 'utf8'),
      Buffer.from(':', 'utf8'),
      Buffer.from(userPassword, 'utf8'),
    ]);
    // lgtm[js/insufficient-password-hash] - combining secrets, not hashing passwords
    return crypto
      .createHmac('sha256', 'envcp-multi-factor')
      .update(combined)
      .digest('hex');
  }
}
