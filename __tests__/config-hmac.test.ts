import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { generateConfigHmac, verifyConfigHmac, deriveHmacKey, getSystemIdentifier } from '../src/config/config-hmac.js';
import { loadConfig, saveConfig, saveConfigSignature } from '../src/config/manager.js';
import { EnvCPConfigSchema } from '../src/types.js';
import { ensureDir, pathExists } from '../src/utils/fs.js';

describe('generateConfigHmac', () => {
  it('produces consistent output for same input', () => {
    const content = 'access:\n  allow_ai_read: true\n';
    const key = 'test-key';
    const result1 = generateConfigHmac(content, key);
    const result2 = generateConfigHmac(content, key);
    expect(result1).toBe(result2);
  });

  it('returns sha256:<hex_digest> format', () => {
    const result = generateConfigHmac('content', 'key');
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('produces different output for different content', () => {
    const key = 'same-key';
    const r1 = generateConfigHmac('content-a', key);
    const r2 = generateConfigHmac('content-b', key);
    expect(r1).not.toBe(r2);
  });

  it('produces different output for different keys', () => {
    const content = 'same-content';
    const r1 = generateConfigHmac(content, 'key-a');
    const r2 = generateConfigHmac(content, 'key-b');
    expect(r1).not.toBe(r2);
  });
});

describe('verifyConfigHmac', () => {
  it('returns true for matching content', () => {
    const content = 'access:\n  allow_ai_read: true\n';
    const key = 'test-key';
    const hmac = generateConfigHmac(content, key);
    expect(verifyConfigHmac(content, hmac, key)).toBe(true);
  });

  it('returns false for tampered content', () => {
    const content = 'access:\n  allow_ai_read: true\n';
    const tampered = 'access:\n  allow_ai_read: false\n';
    const key = 'test-key';
    const hmac = generateConfigHmac(content, key);
    expect(verifyConfigHmac(tampered, hmac, key)).toBe(false);
  });

  it('returns false for wrong key', () => {
    const content = 'content';
    const hmac = generateConfigHmac(content, 'correct-key');
    expect(verifyConfigHmac(content, hmac, 'wrong-key')).toBe(false);
  });

  it('returns false for invalid hmac format', () => {
    expect(verifyConfigHmac('content', 'invalid', 'key')).toBe(false);
  });
});

describe('deriveHmacKey', () => {
  it('produces consistent output for same input', () => {
    const r1 = deriveHmacKey('mypassword');
    const r2 = deriveHmacKey('mypassword');
    expect(r1).toBe(r2);
  });

  it('returns a hex string', () => {
    const result = deriveHmacKey('test');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different output for different input', () => {
    const r1 = deriveHmacKey('password-a');
    const r2 = deriveHmacKey('password-b');
    expect(r1).not.toBe(r2);
  });
});

describe('loadConfig — HMAC integrity', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-hmac-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws on HMAC mismatch', async () => {
    const config = EnvCPConfigSchema.parse({});
    await saveConfig(config, tmpDir);
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');
    await expect(loadConfig(tmpDir)).rejects.toThrow('Config integrity check failed');
  });

  it('works when no signature file exists (backwards compat)', async () => {
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');
    const config = await loadConfig(tmpDir);
    expect(config.access.allow_ai_read).toBe(true);
  });

  it('works when signature matches content', async () => {
    const config = EnvCPConfigSchema.parse({});
    await saveConfig(config, tmpDir);
    const loaded = await loadConfig(tmpDir);
    expect(loaded.version).toBe('1.0');
  });

  it('works when signature exists but no project config file', async () => {
    const envcpDir = path.join(tmpDir, '.envcp');
    await ensureDir(envcpDir);
    await fs.writeFile(path.join(envcpDir, '.config_signature'), 'sha256:abc');
    const config = await loadConfig(tmpDir);
    expect(config.version).toBe('1.0');
  });
});

describe('saveConfig — HMAC signature', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-hmac-save-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates signature file on save', async () => {
    const config = EnvCPConfigSchema.parse({});
    await saveConfig(config, tmpDir);
    const sigPath = path.join(tmpDir, '.envcp', '.config_signature');
    expect(await pathExists(sigPath)).toBe(true);
    const sig = await fs.readFile(sigPath, 'utf8');
    expect(sig).toMatch(/^sha256:/);
  });

  it('signature matches config content', async () => {
    const config = EnvCPConfigSchema.parse({});
    await saveConfig(config, tmpDir);
    const sigPath = path.join(tmpDir, '.envcp', '.config_signature');
    const sig = await fs.readFile(sigPath, 'utf8');
    const content = await fs.readFile(path.join(tmpDir, 'envcp.yaml'), 'utf8');
    const key = deriveHmacKey(getSystemIdentifier());
    expect(verifyConfigHmac(content, sig, key)).toBe(true);
  });
});

describe('saveConfigSignature', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sig-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes signature to .envcp/.config_signature', async () => {
    const key = deriveHmacKey('test-password');
    await saveConfigSignature(tmpDir, 'config-content', key);
    const sigPath = path.join(tmpDir, '.envcp', '.config_signature');
    expect(await pathExists(sigPath)).toBe(true);
  });
});

describe('getSystemIdentifier', () => {
  it('returns a non-empty string', () => {
    const id = getSystemIdentifier();
    expect(id.length).toBeGreaterThan(0);
  });

  it('contains @ separator', () => {
    const id = getSystemIdentifier();
    expect(id).toContain('@');
  });
});
