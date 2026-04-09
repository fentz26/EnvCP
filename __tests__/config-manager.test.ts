import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, saveConfig, initConfig, canAIActiveCheck, requiresUserReference } from '../src/config/manager';
import { EnvCPConfigSchema } from '../src/types';

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('returns defaults when no config exists', async () => {
    const config = await loadConfig(tmpDir);
    expect(config.version).toBe('1.0');
    expect(config.storage.encrypted).toBe(true);
    expect(config.access.allow_ai_read).toBe(false);
  });

  it('loads project config from envcp.yaml', async () => {
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');
    const config = await loadConfig(tmpDir);
    expect(config.access.allow_ai_read).toBe(true);
    // Defaults should still be present
    expect(config.storage.encrypted).toBe(true);
  });

  it('merges global and project configs', async () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const globalDir = path.join(home, '.envcp');
    const globalPath = path.join(globalDir, 'config.yaml');
    const hadGlobal = await fs.pathExists(globalPath);
    let originalContent: string | undefined;

    if (hadGlobal) {
      originalContent = await fs.readFile(globalPath, 'utf8');
    }

    try {
      await fs.ensureDir(globalDir);
      await fs.writeFile(globalPath, 'access:\n  allow_ai_read: true\n  mask_values: false\n');
      // Project overrides mask_values
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  mask_values: true\n');

      const config = await loadConfig(tmpDir);
      expect(config.access.allow_ai_read).toBe(true); // from global
      expect(config.access.mask_values).toBe(true); // project overrides
    } finally {
      if (hadGlobal && originalContent !== undefined) {
        await fs.writeFile(globalPath, originalContent);
      } else if (!hadGlobal) {
        await fs.remove(globalPath);
      }
    }
  });
});

describe('saveConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('writes config to envcp.yaml', async () => {
    const config = EnvCPConfigSchema.parse({});
    await saveConfig(config, tmpDir);
    const content = await fs.readFile(path.join(tmpDir, 'envcp.yaml'), 'utf8');
    expect(content).toContain('version:');
  });
});

describe('initConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-init-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('creates .envcp directory and config', async () => {
    const config = await initConfig(tmpDir, 'test-project');
    expect(config.project).toBe('test-project');
    expect(await fs.pathExists(path.join(tmpDir, '.envcp'))).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, '.envcp', 'logs'))).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, 'envcp.yaml'))).toBe(true);
  });

  it('creates .gitignore if it does not exist', async () => {
    await initConfig(tmpDir);
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.envcp/');
  });

  it('appends to existing .gitignore', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
    await initConfig(tmpDir);
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('.envcp/');
  });

  it('does not duplicate .envcp/ in existing .gitignore', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '.envcp/\n');
    await initConfig(tmpDir);
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    const matches = gitignore.match(/\.envcp\//g);
    expect(matches!.length).toBe(1);
  });

  it('uses directory basename when no project name given', async () => {
    const config = await initConfig(tmpDir);
    expect(config.project).toBe(path.basename(tmpDir));
  });
});

describe('canAIActiveCheck / requiresUserReference', () => {
  it('returns false when allow_ai_active_check is false', () => {
    const config = EnvCPConfigSchema.parse({ access: { allow_ai_active_check: false } });
    expect(canAIActiveCheck(config)).toBe(false);
  });

  it('returns true when allow_ai_active_check is true', () => {
    const config = EnvCPConfigSchema.parse({ access: { allow_ai_active_check: true } });
    expect(canAIActiveCheck(config)).toBe(true);
  });

  it('returns true when require_user_reference is true', () => {
    const config = EnvCPConfigSchema.parse({ access: { require_user_reference: true } });
    expect(requiresUserReference(config)).toBe(true);
  });

  it('returns false when require_user_reference is false', () => {
    const config = EnvCPConfigSchema.parse({ access: { require_user_reference: false } });
    expect(requiresUserReference(config)).toBe(false);
  });
});
