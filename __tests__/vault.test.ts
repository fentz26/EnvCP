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
  });
});
