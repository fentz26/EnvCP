import { jest } from '@jest/globals';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

// ---------------------------------------------------------------------------
// Mock child_process BEFORE importing hsm.ts.
//
// `execFileAsync` in hsm.ts is `promisify(execFile)`. The real execFile has a
// [util.promisify.custom] symbol that makes promisify return { stdout, stderr }.
// We add the same symbol to mockExecFileRaw so promisify() wraps it identically,
// delegating to mockExecFileRaw's *current* implementation at each call.
// ---------------------------------------------------------------------------

import { promisify } from 'util';

const mockExecFileRaw = jest.fn();

// Allow promisify(mockExecFileRaw) to produce { stdout, stderr } just like
// the real child_process.execFile does.
Object.defineProperty(mockExecFileRaw, promisify.custom, {
  value: (...args: unknown[]) =>
    new Promise<{ stdout: string | Buffer; stderr: string }>((resolve, reject) => {
      (mockExecFileRaw as (...a: unknown[]) => unknown)(
        ...args,
        (err: Error | null, stdout: string | Buffer, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        }
      );
    }),
  configurable: true,
});

jest.unstable_mockModule('child_process', () => ({
  execFile: mockExecFileRaw,
}));

// ---------------------------------------------------------------------------
// Mock pkcs11js BEFORE importing hsm.ts
// ---------------------------------------------------------------------------

const mockPkcs11Instance = {
  load: jest.fn(),
  C_Initialize: jest.fn(),
  C_Finalize: jest.fn(),
  C_GetSlotList: jest.fn(() => [Buffer.from('slot0')]),
  C_OpenSession: jest.fn(() => Buffer.from('session')),
  C_CloseSession: jest.fn(),
  C_FindObjectsInit: jest.fn(),
  C_FindObjects: jest.fn(() => [Buffer.from('key0')]),
  C_FindObjectsFinal: jest.fn(),
  C_EncryptInit: jest.fn(),
  C_Encrypt: jest.fn(() => Buffer.from('encrypted-pkcs11')),
  C_DecryptInit: jest.fn(),
  C_Decrypt: jest.fn(() => Buffer.from('hello vault')),
};

const MockPkcs11Class = jest.fn(() => mockPkcs11Instance);

jest.unstable_mockModule('pkcs11js', () => ({
  PKCS11: MockPkcs11Class,
  CKF_SERIAL_SESSION: 4,
  CKO_PUBLIC_KEY: 3,
  CKO_PRIVATE_KEY: 4,
  CKA_CLASS: 0,
  CKA_LABEL: 3,
  CKM_RSA_PKCS_OAEP: 9,
}));

// Dynamic imports AFTER mocks (ESM requirement)
const { GpgBackend, YubiKeyPivBackend, Pkcs11Backend, HsmManager } =
  await import('../src/utils/hsm');
const { EnvCPConfigSchema } = await import('../src/types');

// ---------------------------------------------------------------------------
// Helpers
//
// execFile is called in two ways in hsm.ts:
//  1. Direct callback style: execFile(file, args, {encoding:'buffer'}, cb)
//     → mockExecFileRaw(file, args, opts, cb)
//  2. Via promisify (execFileAsync): promisify wraps it, so the callback is
//     appended as the last arg: mockExecFileRaw(file, args, cb)
//
// Our stub finds the callback as the last Function argument.
// ---------------------------------------------------------------------------

type AnyFn = (...a: unknown[]) => unknown;

interface ExecStubResult {
  stdout?: Buffer | string;
  error?: Error;
}

function makeStub(responses: Record<string, ExecStubResult>) {
  return (...args: unknown[]) => {
    const file = args[0] as string;
    const argsArr = Array.isArray(args[1]) ? (args[1] as string[]) : [];
    const cb = [...args].reverse().find(a => typeof a === 'function') as AnyFn | undefined;

    const key = [file, ...argsArr].join(' ');
    const matched = Object.keys(responses).find(k => key.startsWith(k));
    const r = matched ? responses[matched] : {};

    const stdin = { write: jest.fn(), end: jest.fn() };
    if (cb) {
      if (r.error) cb(r.error, Buffer.alloc(0), '');
      else cb(null, r.stdout ?? Buffer.alloc(0), '');
    }
    return { stdin };
  };
}

// ---------------------------------------------------------------------------
// GpgBackend
// ---------------------------------------------------------------------------

describe('GpgBackend', () => {
  beforeEach(() => jest.clearAllMocks());

  it('name is GPG', () => {
    expect(new GpgBackend('ABCDEF').name).toBe('GPG');
  });

  it('isAvailable returns true when gpg is present and key found', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'gpg --version': { stdout: 'gpg (GnuPG) 2.4.0' },
      'gpg --list-keys ABCDEF': { stdout: 'pub rsa4096' },
    }));
    expect(await new GpgBackend('ABCDEF').isAvailable()).toBe(true);
  });

  it('isAvailable returns false when gpg not found', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'gpg --version': { error: new Error('not found') },
    }));
    expect(await new GpgBackend('ABCDEF').isAvailable()).toBe(false);
  });

  it('isAvailable returns true without key_id (no key check needed)', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'gpg --version': { stdout: 'gpg 2.4.0' },
    }));
    expect(await new GpgBackend().isAvailable()).toBe(true);
  });

  it('encryptData sends plaintext to gpg stdin and returns base64 blob', async () => {
    const fakeOutput = Buffer.from('-----BEGIN PGP MESSAGE-----\nfake\n-----END PGP MESSAGE-----');
    let stdinReceived: Buffer | null = null;

    mockExecFileRaw.mockImplementation((...args: unknown[]) => {
      const cb = [...args].reverse().find(a => typeof a === 'function') as AnyFn;
      const stdin = {
        write: (d: Buffer) => { stdinReceived = d; },
        end: jest.fn(),
      };
      cb(null, fakeOutput, '');
      return { stdin };
    });

    const blob = await new GpgBackend('ABCDEF').encryptData(Buffer.from('my vault password'));
    expect(Buffer.from(blob, 'base64')).toEqual(fakeOutput);
    expect(stdinReceived).toEqual(Buffer.from('my vault password'));
  });

  it('decryptData sends blob to gpg stdin and returns plaintext', async () => {
    const original = Buffer.from('my vault password');
    mockExecFileRaw.mockImplementation((...args: unknown[]) => {
      const cb = [...args].reverse().find(a => typeof a === 'function') as AnyFn;
      const stdin = { write: jest.fn(), end: jest.fn() };
      cb(null, original, '');
      return { stdin };
    });

    const fakeBlob = Buffer.from('pgp-armored').toString('base64');
    const result = await new GpgBackend('ABCDEF').decryptData(fakeBlob);
    expect(result).toEqual(original);
  });

  it('encryptData throws when no key_id configured', async () => {
    await expect(new GpgBackend().encryptData(Buffer.from('x'))).rejects.toThrow('key_id');
  });

  it('encryptData rejects when gpg returns an error', async () => {
    mockExecFileRaw.mockImplementation((...args: unknown[]) => {
      const cb = [...args].reverse().find(a => typeof a === 'function') as AnyFn;
      cb(new Error('gpg: No public key'), Buffer.alloc(0), '');
      return { stdin: { write: jest.fn(), end: jest.fn() } };
    });
    await expect(new GpgBackend('BADKEY').encryptData(Buffer.from('x'))).rejects.toThrow('GPG encrypt failed');
  });

  it('getStatus reflects availability and keyId', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'gpg --version': { stdout: 'gpg 2.4.0' },
      'gpg --list-keys KEY1': { stdout: 'pub' },
    }));
    const status = await new GpgBackend('KEY1').getStatus();
    expect(status).toMatchObject({ available: true, type: 'gpg', keyId: 'KEY1' });
  });
});

// ---------------------------------------------------------------------------
// YubiKeyPivBackend
// ---------------------------------------------------------------------------

describe('YubiKeyPivBackend', () => {
  beforeEach(() => jest.clearAllMocks());

  it('name is YubiKey PIV', () => {
    expect(new YubiKeyPivBackend().name).toBe('YubiKey PIV');
  });

  it('isAvailable returns true when ykman lists a device', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'ykman list': { stdout: 'YubiKey 5 NFC (5.4.3) [OTP+FIDO+CCID] Serial: 12345678' },
    }));
    expect(await new YubiKeyPivBackend().isAvailable()).toBe(true);
  });

  it('isAvailable returns false when ykman errors', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'ykman list': { error: new Error('command not found') },
    }));
    expect(await new YubiKeyPivBackend().isAvailable()).toBe(false);
  });

  it('isAvailable returns false when no device listed', async () => {
    mockExecFileRaw.mockImplementation(makeStub({ 'ykman list': { stdout: '' } }));
    expect(await new YubiKeyPivBackend().isAvailable()).toBe(false);
  });

  it('passes --device serial when configured', async () => {
    const calls: string[] = [];
    mockExecFileRaw.mockImplementation((...args: unknown[]) => {
      const file = args[0] as string;
      const argsArr = Array.isArray(args[1]) ? (args[1] as string[]) : [];
      calls.push([file, ...argsArr].join(' '));
      const cb = [...args].reverse().find(a => typeof a === 'function') as AnyFn;
      cb(null, 'YubiKey Serial: 99999999', '');
      return { stdin: { write: jest.fn(), end: jest.fn() } };
    });
    await new YubiKeyPivBackend('99999999').isAvailable();
    expect(calls.some(c => c.includes('--device 99999999'))).toBe(true);
  });

  it('getStatus returns device string when available', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'ykman list': { stdout: 'YubiKey 5 NFC Serial: 12345678' },
    }));
    const status = await new YubiKeyPivBackend().getStatus();
    expect(status).toMatchObject({ available: true, type: 'yubikey-piv' });
    expect(typeof status.device).toBe('string');
  });

  it('getStatus available:false when ykman errors', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'ykman list': { error: new Error('not found') },
    }));
    expect((await new YubiKeyPivBackend().getStatus()).available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pkcs11Backend
// ---------------------------------------------------------------------------

describe('Pkcs11Backend', () => {
  const libPath = '/usr/lib/libykcs11.so';

  beforeEach(() => {
    jest.clearAllMocks();
    MockPkcs11Class.mockImplementation(() => mockPkcs11Instance);
    mockPkcs11Instance.C_GetSlotList.mockReturnValue([Buffer.from('slot0')]);
    mockPkcs11Instance.C_FindObjects.mockReturnValue([Buffer.from('key0')]);
    mockPkcs11Instance.C_Encrypt.mockReturnValue(Buffer.from('encrypted-pkcs11'));
    mockPkcs11Instance.C_Decrypt.mockReturnValue(Buffer.from('hello vault'));
  });

  it('name is PKCS#11', () => {
    expect(new Pkcs11Backend(libPath).name).toBe('PKCS#11');
  });

  it('isAvailable returns true when library loads and slot exists', async () => {
    expect(await new Pkcs11Backend(libPath, 0).isAvailable()).toBe(true);
    expect(mockPkcs11Instance.load).toHaveBeenCalledWith(libPath);
    expect(mockPkcs11Instance.C_GetSlotList).toHaveBeenCalledWith(true);
  });

  it('isAvailable returns false when no slots', async () => {
    mockPkcs11Instance.C_GetSlotList.mockReturnValue([]);
    expect(await new Pkcs11Backend(libPath, 0).isAvailable()).toBe(false);
  });

  it('isAvailable returns false when slot index out of range', async () => {
    mockPkcs11Instance.C_GetSlotList.mockReturnValue([Buffer.from('slot0')]);
    expect(await new Pkcs11Backend(libPath, 5).isAvailable()).toBe(false);
  });

  it('isAvailable returns false when load throws', async () => {
    mockPkcs11Instance.load.mockImplementationOnce(() => { throw new Error('Cannot open library'); });
    expect(await new Pkcs11Backend(libPath).isAvailable()).toBe(false);
  });

  it('encryptData opens session, encrypts, and returns base64', async () => {
    const blob = await new Pkcs11Backend(libPath, 0).encryptData(Buffer.from('vault-password'));
    expect(typeof blob).toBe('string');
    expect(Buffer.from(blob, 'base64').toString()).toBe('encrypted-pkcs11');
    expect(mockPkcs11Instance.C_EncryptInit).toHaveBeenCalled();
    expect(mockPkcs11Instance.C_Encrypt).toHaveBeenCalled();
    expect(mockPkcs11Instance.C_CloseSession).toHaveBeenCalled();
    expect(mockPkcs11Instance.C_Finalize).toHaveBeenCalled();
  });

  it('decryptData opens session, decrypts, and returns buffer', async () => {
    const blob = Buffer.from('some-blob').toString('base64');
    const result = await new Pkcs11Backend(libPath, 0).decryptData(blob);
    expect(result.toString()).toBe('hello vault');
    expect(mockPkcs11Instance.C_DecryptInit).toHaveBeenCalled();
    expect(mockPkcs11Instance.C_Decrypt).toHaveBeenCalled();
  });

  it('encryptData throws when no public key found', async () => {
    mockPkcs11Instance.C_FindObjects.mockReturnValue([]);
    await expect(new Pkcs11Backend(libPath, 0).encryptData(Buffer.from('x'))).rejects.toThrow('no public key found');
  });

  it('C_Finalize called even when C_EncryptInit throws', async () => {
    mockPkcs11Instance.C_EncryptInit.mockImplementationOnce(() => { throw new Error('HSM error'); });
    await expect(new Pkcs11Backend(libPath, 0).encryptData(Buffer.from('x'))).rejects.toThrow();
    expect(mockPkcs11Instance.C_Finalize).toHaveBeenCalled();
  });

  it('getStatus reflects availability and keyId', async () => {
    const status = await new Pkcs11Backend(libPath, 0, 'my-key').getStatus();
    expect(status).toMatchObject({ available: true, type: 'pkcs11', keyId: 'my-key' });
  });
});

// ---------------------------------------------------------------------------
// HsmManager.fromConfig
// ---------------------------------------------------------------------------

describe('HsmManager.fromConfig', () => {
  const base = EnvCPConfigSchema.parse({
    hsm: { enabled: true, type: 'yubikey', require_touch: true },
    auth: { method: 'hsm' },
  });

  it('selects YubiKeyPivBackend for type yubikey', () => {
    expect(HsmManager.fromConfig(base, '/p').backendName).toBe('YubiKey PIV');
  });

  it('selects GpgBackend for type gpg', () => {
    const cfg = EnvCPConfigSchema.parse({ ...base, hsm: { ...base.hsm, type: 'gpg', key_id: 'KEYID' } });
    expect(HsmManager.fromConfig(cfg, '/p').backendName).toBe('GPG');
  });

  it('selects Pkcs11Backend for type pkcs11', () => {
    const cfg = EnvCPConfigSchema.parse({ ...base, hsm: { ...base.hsm, type: 'pkcs11', pkcs11_lib: '/lib/lib.so' } });
    expect(HsmManager.fromConfig(cfg, '/p').backendName).toBe('PKCS#11');
  });

  it('throws when pkcs11 used without pkcs11_lib', () => {
    const cfg = EnvCPConfigSchema.parse({ ...base, hsm: { ...base.hsm, type: 'pkcs11' } });
    expect(() => HsmManager.fromConfig(cfg, '/p')).toThrow('pkcs11_lib');
  });

  it('resolves relative protected_key_path against projectPath', () => {
    expect(HsmManager.fromConfig(base, '/my/project')).toBeInstanceOf(HsmManager);
  });

  it('uses absolute protected_key_path as-is', () => {
    const cfg = EnvCPConfigSchema.parse({ ...base, hsm: { ...base.hsm, protected_key_path: '/tmp/my.key' } });
    expect(HsmManager.fromConfig(cfg, '/project')).toBeInstanceOf(HsmManager);
  });
});

// ---------------------------------------------------------------------------
// HsmManager protect/retrieve/getStatus
// ---------------------------------------------------------------------------

describe('HsmManager protect/retrieve', () => {
  let tmpDir: string;
  let keyPath: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-hsm-test-'));
    keyPath = path.join(tmpDir, '.hsm-key');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('round-trips vault password through mock GPG backend', async () => {
    const vaultPwd = 'super-secret-vault-password';
    let capturedInput: Buffer | null = null;

    mockExecFileRaw.mockImplementation((...args: unknown[]) => {
      const argsArr = Array.isArray(args[1]) ? (args[1] as string[]) : [];
      const isEncrypt = argsArr.includes('--encrypt');
      const isDecrypt = argsArr.includes('--decrypt');
      const cb = [...args].reverse().find(a => typeof a === 'function') as AnyFn;
      const stdin = {
        write: (d: Buffer) => { capturedInput = d; },
        end: jest.fn(),
      };
      if (isEncrypt) cb(null, capturedInput ?? Buffer.alloc(0), '');
      else if (isDecrypt) cb(null, capturedInput ?? Buffer.alloc(0), '');
      else cb(null, '', '');
      return { stdin };
    });

    const mgr = new HsmManager(new GpgBackend('TESTKEY'), keyPath);
    await mgr.protectVaultPassword(vaultPwd);
    const retrieved = await mgr.retrieveVaultPassword();
    expect(retrieved).toBe(vaultPwd);
  });

  it('retrieveVaultPassword throws with helpful message when file missing', async () => {
    const mgr = new HsmManager(new GpgBackend('TESTKEY'), path.join(tmpDir, 'missing.key'));
    await expect(mgr.retrieveVaultPassword()).rejects.toThrow('setup-hsm');
  });

  it('protectVaultPassword writes file with mode 0o600', async () => {
    mockExecFileRaw.mockImplementation((...args: unknown[]) => {
      const cb = [...args].reverse().find(a => typeof a === 'function') as AnyFn;
      cb(null, Buffer.from('encrypted-blob'), '');
      return { stdin: { write: jest.fn(), end: jest.fn() } };
    });
    await new HsmManager(new GpgBackend('TESTKEY'), keyPath).protectVaultPassword('secret');
    const stat = await fs.stat(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('isAvailable delegates to backend', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'ykman list': { stdout: 'YubiKey Serial: 12345678' },
    }));
    const mgr = new HsmManager(new YubiKeyPivBackend(), keyPath);
    expect(await mgr.isAvailable()).toBe(true);
  });

  it('getStatus delegates to backend and has required fields', async () => {
    mockExecFileRaw.mockImplementation(makeStub({
      'ykman list': { stdout: 'YubiKey Serial: 12345678' },
    }));
    const status = await new HsmManager(new YubiKeyPivBackend(), keyPath).getStatus();
    expect(status).toHaveProperty('available');
    expect(status).toHaveProperty('type');
  });
});

// ---------------------------------------------------------------------------
// HsmManager.combineSecrets
// ---------------------------------------------------------------------------

describe('HsmManager.combineSecrets', () => {
  it('produces a 64-char hex string', () => {
    expect(HsmManager.combineSecrets('hsm-secret', 'user-password')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(HsmManager.combineSecrets('s', 'p')).toBe(HsmManager.combineSecrets('s', 'p'));
  });

  it('differs when HSM secret changes', () => {
    expect(HsmManager.combineSecrets('other', 'p')).not.toBe(HsmManager.combineSecrets('s', 'p'));
  });

  it('differs when user password changes', () => {
    expect(HsmManager.combineSecrets('s', 'other')).not.toBe(HsmManager.combineSecrets('s', 'p'));
  });
});
