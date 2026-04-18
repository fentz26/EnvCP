import { jest, describe, it, expect, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { generateConfigHmac, verifyConfigHmac, deriveHmacKey, getSystemIdentifier } from '../src/config/config-hmac.js';
import { loadConfig, saveConfig, saveConfigSignature } from '../src/config/manager.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  tmpDirs.length = 0;
});

async function tmpDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-hmac-'));
  tmpDirs.push(d);
  return d;
}

describe('config-hmac', () => {
  it('generateConfigHmac produces consistent output', () => {
    const key = deriveHmacKey('test-key');
    const result1 = generateConfigHmac('test content', key);
    const result2 = generateConfigHmac('test content', key);
    expect(result1).toBe(result2);
  });

  it('generateConfigHmac produces sha256 prefix', () => {
    const key = deriveHmacKey('test-key');
    const result = generateConfigHmac('test content', key);
    expect(result).toMatch(/^sha256:[a-f0-9]+$/);
  });

  it('generateConfigHmac differs for different content', () => {
    const key = deriveHmacKey('test-key');
    const r1 = generateConfigHmac('content a', key);
    const r2 = generateConfigHmac('content b', key);
    expect(r1).not.toBe(r2);
  });

  it('verifyConfigHmac returns true for matching content', () => {
    const key = deriveHmacKey('test-key');
    const hmac = generateConfigHmac('test content', key);
    expect(verifyConfigHmac('test content', hmac, key)).toBe(true);
  });

  it('verifyConfigHmac returns false for tampered content', () => {
    const key = deriveHmacKey('test-key');
    const hmac = generateConfigHmac('test content', key);
    expect(verifyConfigHmac('tampered content', hmac, key)).toBe(false);
  });

  it('verifyConfigHmac returns false for invalid format', () => {
    const key = deriveHmacKey('test-key');
    expect(verifyConfigHmac('test', 'invalid-format', key)).toBe(false);
  });

  it('deriveHmacKey produces consistent output', () => {
    expect(deriveHmacKey('same-input')).toBe(deriveHmacKey('same-input'));
  });

  it('getSystemIdentifier returns string with @', () => {
    const id = getSystemIdentifier();
    expect(id).toContain('@');
  });
});

describe('config HMAC integration with loadConfig', () => {
  it('loadConfig throws on HMAC mismatch', async () => {
    const dir = await tmpDir();
    const envcpDir = path.join(dir, '.envcp');
    await fs.mkdir(envcpDir, { recursive: true });

    const configContent = 'version: "1.0"\naccess:\n  allow_ai_read: false\n';
    await fs.writeFile(path.join(dir, 'envcp.yaml'), configContent);
    const key = deriveHmacKey(getSystemIdentifier());
    const validHmac = generateConfigHmac(configContent, key);
    await fs.writeFile(path.join(envcpDir, '.config_signature'), validHmac);

    await fs.writeFile(path.join(dir, 'envcp.yaml'), 'version: "1.0"\naccess:\n  allow_ai_read: true\n');

    await expect(loadConfig(dir)).rejects.toThrow('Config integrity check failed');
  });

  it('loadConfig works when no signature file exists', async () => {
    const dir = await tmpDir();
    const envcpDir = path.join(dir, '.envcp');
    await fs.mkdir(envcpDir, { recursive: true });
    await fs.writeFile(path.join(dir, 'envcp.yaml'), 'version: "1.0"\naccess:\n  allow_ai_read: false\n');

    const config = await loadConfig(dir);
    expect(config.version).toBe('1.0');
  });

  it('loadConfig works when signature matches', async () => {
    const dir = await tmpDir();
    const envcpDir = path.join(dir, '.envcp');
    await fs.mkdir(envcpDir, { recursive: true });

    const configContent = 'version: "1.0"\naccess:\n  allow_ai_read: false\n';
    await fs.writeFile(path.join(dir, 'envcp.yaml'), configContent);
    const key = deriveHmacKey(getSystemIdentifier());
    await fs.writeFile(path.join(envcpDir, '.config_signature'), generateConfigHmac(configContent, key));

    const config = await loadConfig(dir);
    expect(config.version).toBe('1.0');
  });
});

describe('config HMAC integration with saveConfig', () => {
  it('saveConfig creates signature file', async () => {
    const dir = await tmpDir();
    const envcpDir = path.join(dir, '.envcp');
    await fs.mkdir(envcpDir, { recursive: true });

    await fs.writeFile(path.join(dir, 'envcp.yaml'), 'version: "1.0"\naccess:\n  allow_ai_read: false\n');
    const config = await loadConfig(dir);

    await saveConfig(config, dir);

    const sigPath = path.join(envcpDir, '.config_signature');
    expect(await fs.stat(sigPath)).toBeTruthy();
    const sig = await fs.readFile(sigPath, 'utf8');
    expect(sig).toMatch(/^sha256:/);
  });

  it('saveConfigSignature creates verifiable signature', async () => {
    const dir = await tmpDir();
    const envcpDir = path.join(dir, '.envcp');
    await fs.mkdir(envcpDir, { recursive: true });

    const content = 'version: "1.0"\naccess:\n  allow_ai_read: false\n';
    const key = deriveHmacKey(getSystemIdentifier());
    await saveConfigSignature(dir, content, key);

    const sigPath = path.join(envcpDir, '.config_signature');
    const sig = await fs.readFile(sigPath, 'utf8');
    expect(verifyConfigHmac(content, sig, key)).toBe(true);
  });
});
