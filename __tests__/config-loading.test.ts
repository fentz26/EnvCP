import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { loadConfig, saveConfig } from '../src/config/manager';
import { EnvCPConfigSchema } from '../src/types';

describe('loadConfig', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-test-'));
    origHome = process.env.HOME;
    // Point HOME to a directory without a global config
    process.env.HOME = path.join(tmpDir, 'home');
    await fs.ensureDir(path.join(tmpDir, 'home'));
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.remove(tmpDir);
  });

  it('returns defaults when no config files exist', async () => {
    const config = await loadConfig(tmpDir);

    expect(config.version).toBe('1.0');
    expect(config.storage.path).toBe('.envcp/store.enc');
    expect(config.storage.encrypted).toBe(true);
    expect(config.access.allow_ai_read).toBe(false);
    expect(config.session.timeout_minutes).toBe(30);
    expect(config.encryption.enabled).toBe(true);
  });

  it('loads project config and overrides defaults', async () => {
    const projectConfig = {
      storage: { path: '.envcp/custom.enc', encrypted: false },
      access: { allow_ai_read: true, allow_ai_write: true },
    };

    await fs.writeFile(
      path.join(tmpDir, 'envcp.yaml'),
      yaml.dump(projectConfig),
      'utf8',
    );

    const config = await loadConfig(tmpDir);

    expect(config.storage.path).toBe('.envcp/custom.enc');
    expect(config.storage.encrypted).toBe(false);
    expect(config.access.allow_ai_read).toBe(true);
    expect(config.access.allow_ai_write).toBe(true);
    // Defaults are preserved for unset fields
    expect(config.session.timeout_minutes).toBe(30);
  });

  it('loads global config and applies it', async () => {
    const globalConfig = {
      session: { timeout_minutes: 60 },
    };

    const globalDir = path.join(tmpDir, 'home', '.envcp');
    await fs.ensureDir(globalDir);
    await fs.writeFile(
      path.join(globalDir, 'config.yaml'),
      yaml.dump(globalConfig),
      'utf8',
    );

    const config = await loadConfig(tmpDir);

    expect(config.session.timeout_minutes).toBe(60);
  });

  it('project config overrides global config', async () => {
    const globalConfig = { session: { timeout_minutes: 60 } };
    const projectConfig = { session: { timeout_minutes: 10 } };

    const globalDir = path.join(tmpDir, 'home', '.envcp');
    await fs.ensureDir(globalDir);
    await fs.writeFile(
      path.join(globalDir, 'config.yaml'),
      yaml.dump(globalConfig),
      'utf8',
    );
    await fs.writeFile(
      path.join(tmpDir, 'envcp.yaml'),
      yaml.dump(projectConfig),
      'utf8',
    );

    const config = await loadConfig(tmpDir);

    expect(config.session.timeout_minutes).toBe(10);
  });

  it('deep merges nested config objects', async () => {
    const projectConfig = {
      access: { allow_ai_read: true },
    };

    await fs.writeFile(
      path.join(tmpDir, 'envcp.yaml'),
      yaml.dump(projectConfig),
      'utf8',
    );

    const config = await loadConfig(tmpDir);

    // Overridden field
    expect(config.access.allow_ai_read).toBe(true);
    // Other access fields keep their defaults
    expect(config.access.allow_ai_write).toBe(false);
    expect(config.access.mask_values).toBe(true);
  });

  it('handles empty project config file gracefully', async () => {
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), '', 'utf8');

    const config = await loadConfig(tmpDir);

    expect(config.version).toBe('1.0');
  });
});

describe('saveConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-save-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('writes a valid YAML config file', async () => {
    const config = EnvCPConfigSchema.parse({});

    await saveConfig(config, tmpDir);

    const written = await fs.readFile(path.join(tmpDir, 'envcp.yaml'), 'utf8');
    const parsed = yaml.load(written) as Record<string, unknown>;

    expect(parsed).toBeDefined();
    expect((parsed.storage as Record<string, unknown>).encrypted).toBe(true);
  });

  it('round-trips config through save and loadConfig', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, 'home');
    await fs.ensureDir(path.join(tmpDir, 'home'));

    try {
      const original = EnvCPConfigSchema.parse({
        session: { timeout_minutes: 45 },
        access: { allow_ai_read: true },
      });

      await saveConfig(original, tmpDir);
      const loaded = await loadConfig(tmpDir);

      expect(loaded.session.timeout_minutes).toBe(45);
      expect(loaded.access.allow_ai_read).toBe(true);
    } finally {
      process.env.HOME = origHome;
    }
  });
});
