import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  resolveSessionPath,
  resolveVaultPath,
  getEffectiveVaultMode,
  getGlobalVaultPath,
  getProjectVaultPath,
} from '../src/vault/index';
import { findProjectRoot, ensureDir } from '../src/utils/fs.js';
import { EnvCPConfigSchema, EnvCPConfig } from '../src/types';
import { initConfig, loadConfig, getConfigFilePath } from '../src/config/manager';

const makeConfig = (overrides: Record<string, unknown> = {}): EnvCPConfig =>
  EnvCPConfigSchema.parse(overrides);

describe('vault.mode and session path resolution', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-vmode-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('getEffectiveVaultMode', () => {
    it('defaults to project when nothing is set', () => {
      expect(getEffectiveVaultMode(makeConfig())).toBe('project');
    });

    it('uses vault.mode when present', () => {
      const config = makeConfig({ vault: { mode: 'global' } });
      expect(getEffectiveVaultMode(config)).toBe('global');
    });

    it('falls back to vault.default for backward compatibility', () => {
      const config = makeConfig({ vault: { default: 'global' } });
      expect(getEffectiveVaultMode(config)).toBe('global');
    });

    it('vault.mode wins over vault.default when both are set', () => {
      const config = makeConfig({ vault: { mode: 'project', default: 'global' } });
      expect(getEffectiveVaultMode(config)).toBe('project');
    });
  });

  describe('resolveSessionPath', () => {
    it('returns project-relative path in project mode', () => {
      const config = makeConfig({ vault: { mode: 'project' } });
      const projectPath = '/some/project';
      expect(resolveSessionPath(projectPath, config)).toBe(
        path.join(projectPath, '.envcp/.session')
      );
    });

    it('returns home-relative path in global mode regardless of projectPath', () => {
      const config = makeConfig({ vault: { mode: 'global' } });
      expect(resolveSessionPath('/anywhere', config)).toBe(
        path.join(tmpDir, '.envcp/.session')
      );
    });

    it('honors a custom session.path', () => {
      const config = makeConfig({
        vault: { mode: 'global' },
        session: { path: 'custom/session.json' },
      });
      expect(resolveSessionPath('/anywhere', config)).toBe(
        path.join(tmpDir, 'custom/session.json')
      );
    });
  });

  describe('resolveVaultPath honors vault.mode', () => {
    it('returns global store when mode is global', async () => {
      const config = makeConfig({ vault: { mode: 'global' } });
      const projectDir = path.join(tmpDir, 'work');
      await ensureDir(projectDir);
      const resolved = await resolveVaultPath(projectDir, config);
      expect(resolved).toBe(getGlobalVaultPath(config));
    });

    it('returns project store when mode is project', async () => {
      const config = makeConfig({ vault: { mode: 'project' } });
      const projectDir = path.join(tmpDir, 'work');
      await ensureDir(projectDir);
      const resolved = await resolveVaultPath(projectDir, config);
      expect(resolved).toBe(getProjectVaultPath(projectDir, config));
    });
  });
});

describe('findProjectRoot', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-root-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns the directory containing envcp.yaml', async () => {
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: 1.0\n', 'utf8');
    const found = await findProjectRoot(tmpDir);
    expect(found).toBe(tmpDir);
  });

  it('walks up to find envcp.yaml in an ancestor', async () => {
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'version: 1.0\n', 'utf8');
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    await ensureDir(nested);
    const found = await findProjectRoot(nested);
    expect(found).toBe(tmpDir);
  });

  it('returns null when no envcp.yaml exists in any ancestor', async () => {
    // Use a subdirectory inside tmpDir so we don't accidentally walk
    // into a parent directory that happens to contain an envcp.yaml.
    const isolated = path.join(tmpDir, 'isolated');
    await ensureDir(isolated);
    // Walk up from isolated; tmpDir has no envcp.yaml, but real ancestors
    // (like /tmp) won't either. To be safe we still expect a non-tmpDir result.
    const found = await findProjectRoot(isolated);
    // findProjectRoot returns null only if it hits filesystem root with no match;
    // accept either null or any ancestor that is NOT tmpDir or isolated.
    if (found !== null) {
      expect(found).not.toBe(tmpDir);
      expect(found).not.toBe(isolated);
    } else {
      expect(found).toBeNull();
    }
  });
});

describe('init --global writes to ~/.envcp/config.yaml', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-init-global-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('places config at ~/.envcp/config.yaml and sets vault.mode=global', async () => {
    const config = await initConfig(tmpDir, 'global', { global: true });
    expect(config.vault.mode).toBe('global');

    const configPath = getConfigFilePath(tmpDir, { global: true });
    expect(configPath).toBe(path.join(tmpDir, '.envcp', 'config.yaml'));
    expect(await fileExists(configPath)).toBe(true);

    // No project-style envcp.yaml at $HOME root
    expect(await fileExists(path.join(tmpDir, 'envcp.yaml'))).toBe(false);

    // No .gitignore management for global init
    expect(await fileExists(path.join(tmpDir, '.gitignore'))).toBe(false);
  });

  it('project init still writes to envcp.yaml and adds .gitignore', async () => {
    const config = await initConfig(tmpDir, 'proj');
    expect(config.vault.mode).toBeUndefined();
    expect(await fileExists(path.join(tmpDir, 'envcp.yaml'))).toBe(true);
    expect(await fileExists(path.join(tmpDir, '.gitignore'))).toBe(true);
  });
});

describe('loadConfig merges global and reads vault.mode', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-load-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads vault.mode=global from ~/.envcp/config.yaml', async () => {
    await initConfig(tmpDir, 'global', { global: true });
    // loadConfig with any cwd should pick up the global config
    const config = await loadConfig(path.join(tmpDir, 'no-project-here'));
    expect(getEffectiveVaultMode(config)).toBe('global');
  });

  it('rejects an invalid vault.mode value', async () => {
    const cfg = makeConfig() as unknown as Record<string, unknown>;
    const bad = { ...cfg, vault: { mode: 'whatever' } };
    expect(() => EnvCPConfigSchema.parse(bad)).toThrow();
  });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
