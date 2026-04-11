import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import {
  getGlobalVaultPath,
  getProjectVaultPath,
  resolveVaultPath,
  getActiveVault,
  setActiveVault,
  listVaults,
  initNamedVault,
} from '../src/vault/index';
import { EnvCPConfigSchema } from '../src/types';

const makeConfig = () => EnvCPConfigSchema.parse({});

describe('vault manager', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-vault-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('getGlobalVaultPath', () => {
    it('returns path in home directory', () => {
      const config = makeConfig();
      const vaultPath = getGlobalVaultPath(config);
      expect(vaultPath).toBe(path.join(tmpDir, '.envcp/store.enc'));
    });
  });

  describe('getProjectVaultPath', () => {
    it('returns path in project directory', () => {
      const config = makeConfig();
      const projectPath = '/my/project';
      const vaultPath = getProjectVaultPath(projectPath, config);
      expect(vaultPath).toBe(path.join(projectPath, '.envcp/store.enc'));
    });
  });

  describe('getActiveVault', () => {
    it('returns null when no active vault file', async () => {
      const active = await getActiveVault(tmpDir);
      expect(active).toBeNull();
    });

    it('returns vault name when file exists', async () => {
      await setActiveVault(tmpDir, 'global');
      const active = await getActiveVault(tmpDir);
      expect(active).toBe('global');
    });
  });

  describe('setActiveVault', () => {
    it('creates active vault file', async () => {
      await setActiveVault(tmpDir, 'project');
      const active = await getActiveVault(tmpDir);
      expect(active).toBe('project');
    });
  });

  describe('resolveVaultPath', () => {
    it('returns project vault by default', async () => {
      const config = makeConfig();
      const vaultPath = await resolveVaultPath(tmpDir, config);
      expect(vaultPath).toBe(path.join(tmpDir, '.envcp/store.enc'));
    });

    it('returns global vault when active vault is global', async () => {
      const config = makeConfig();
      await setActiveVault(tmpDir, 'global');
      const vaultPath = await resolveVaultPath(tmpDir, config);
      expect(vaultPath).toBe(path.join(tmpDir, '.envcp/store.enc'));
    });

    it('returns named vault when active vault is named', async () => {
      const config = makeConfig();
      const namedPath = await initNamedVault(tmpDir, 'myvault');
      await setActiveVault(tmpDir, 'myvault');
      const vaultPath = await resolveVaultPath(tmpDir, config);
      expect(vaultPath).toBe(namedPath);
    });
  });

  describe('initNamedVault', () => {
    it('creates vault directory', async () => {
      const vaultPath = await initNamedVault(tmpDir, 'testvault');
      expect(vaultPath).toBe(path.join(tmpDir, '.envcp/vaults/testvault/store.enc'));
      expect(await pathExists(path.dirname(vaultPath))).toBe(true);
    });

    it('rejects reserved names', async () => {
      await expect(initNamedVault(tmpDir, 'project')).rejects.toThrow('reserved');
      await expect(initNamedVault(tmpDir, 'global')).rejects.toThrow('reserved');
    });

    it('rejects invalid names', async () => {
      await expect(initNamedVault(tmpDir, 'my vault')).rejects.toThrow('letters, numbers');
      await expect(initNamedVault(tmpDir, 'my/vault')).rejects.toThrow('letters, numbers');
    });
  });

  describe('listVaults', () => {
    it('lists project and global vaults', async () => {
      const config = makeConfig();
      const vaults = await listVaults(tmpDir, config);
      expect(vaults.length).toBeGreaterThanOrEqual(2);
      expect(vaults.find(v => v.name === 'project')).toBeDefined();
      expect(vaults.find(v => v.name === 'global')).toBeDefined();
    });

    it('marks active vault', async () => {
      const config = makeConfig();
      await setActiveVault(tmpDir, 'global');
      const vaults = await listVaults(tmpDir, config);
      const globalVault = vaults.find(v => v.name === 'global');
      expect(globalVault!.active).toBe(true);
    });

    it('lists named vaults', async () => {
      const config = makeConfig();
      await initNamedVault(tmpDir, 'named1');
      await initNamedVault(tmpDir, 'named2');
      const vaults = await listVaults(tmpDir, config);
      expect(vaults.find(v => v.name === 'named1')).toBeDefined();
      expect(vaults.find(v => v.name === 'named2')).toBeDefined();
    });

    it('skips non-directory entries in named vaults dir — line 78', async () => {
      const config = makeConfig();
      const namedDir = path.join(tmpDir, '.envcp', 'vaults');
      await ensureDir(namedDir);
      // Place a file (not a directory) in the vaults dir — should be skipped
      await fs.writeFile(path.join(namedDir, 'not-a-vault.txt'), 'file');
      const vaults = await listVaults(tmpDir, config);
      expect(vaults.find(v => v.name === 'not-a-vault.txt')).toBeUndefined();
    });
  });

  describe('getActiveVault empty file — line 44', () => {
    it('returns null when active vault file contains only whitespace', async () => {
      const activeFile = path.join(tmpDir, '.envcp', '.active-vault');
      await ensureDir(path.dirname(activeFile));
      await fs.writeFile(activeFile, '   ');
      const active = await getActiveVault(tmpDir);
      expect(active).toBeNull();
    });
  });

  describe('resolveVaultPath with named vault — lines 25, 29', () => {
    it('returns named vault path when active vault dir exists — line 25', async () => {
      const config = makeConfig();
      await initNamedVault(tmpDir, 'staging');
      await setActiveVault(tmpDir, 'staging');
      const vaultPath = await resolveVaultPath(tmpDir, config);
      expect(vaultPath).toContain('staging');
      expect(vaultPath).toContain('store.enc');
    });

    it('falls back to default when named active vault dir missing — line 29', async () => {
      const config = makeConfig();
      // Set active vault to a named vault that doesn't exist
      await setActiveVault(tmpDir, 'nonexistent-vault');
      // resolveVaultPath should fall through to default (project)
      const vaultPath = await resolveVaultPath(tmpDir, config);
      expect(vaultPath).toBe(path.join(tmpDir, '.envcp/store.enc'));
    });
  });

  describe('getGlobalVaultPath USERPROFILE fallback — line 11', () => {
    let origUserProfile: string | undefined;

    beforeEach(() => {
      origUserProfile = process.env.USERPROFILE;
    });

    afterEach(() => {
      if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
      else delete process.env.USERPROFILE;
    });

    it('uses USERPROFILE when HOME is unset', () => {
      const savedHome = process.env.HOME;
      delete process.env.HOME;
      process.env.USERPROFILE = tmpDir;
      try {
        const config = makeConfig();
        const vaultPath = getGlobalVaultPath(config);
        expect(vaultPath).toContain(tmpDir);
      } finally {
        if (savedHome !== undefined) process.env.HOME = savedHome;
      }
    });

    it('falls back to os.homedir() when both HOME and USERPROFILE are unset', () => {
      const savedHome = process.env.HOME;
      const savedUserProfile = process.env.USERPROFILE;
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      try {
        const config = makeConfig();
        const vaultPath = getGlobalVaultPath(config);
        // Should use os.homedir() — just verify it returns a non-empty path
        expect(vaultPath.length).toBeGreaterThan(0);
      } finally {
        if (savedHome !== undefined) process.env.HOME = savedHome;
        if (savedUserProfile !== undefined) process.env.USERPROFILE = savedUserProfile;
      }
    });
  });
});
