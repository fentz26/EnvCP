import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import { BaseAdapter } from '../src/adapters/base';
import { EnvCPConfig, EnvCPConfigSchema, Variable } from '../src/types';

class TestAdapter extends BaseAdapter {
  protected registerTools(): void {
    this.registerDefaultTools();
  }

  async seedVariable(variable: Variable): Promise<void> {
    await this.storage.set(variable.name, variable);
  }

  async runSyncToEnv(): Promise<{ success: boolean; message: string }> {
    return this.syncToEnv();
  }
}

describe('BaseAdapter.syncToEnv path hardening', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sync-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const buildConfig = (target: string): EnvCPConfig => EnvCPConfigSchema.parse({
    access: { allow_ai_export: true },
    sync: { enabled: true, target },
    encryption: { enabled: false },
    storage: { encrypted: false, path: '.envcp/store.json' },
  });

  const seedApiKey = async (adapter: TestAdapter): Promise<void> => {
    const now = new Date().toISOString();
    await adapter.seedVariable({
      name: 'API_KEY',
      value: 'secret',
      encrypted: false,
      created: now,
      updated: now,
      sync_to_env: true,
    });
  };

  it('writes to a normal relative sync target', async () => {
    const adapter = new TestAdapter(buildConfig('.env'), tmpDir);
    await adapter.init();
    await seedApiKey(adapter);

    const result = await adapter.runSyncToEnv();

    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
    expect(content).toContain('API_KEY=secret');
  });

  it('blocks ../ traversal targets', async () => {
    const adapter = new TestAdapter(buildConfig('../outside.env'), tmpDir);
    await adapter.init();
    await seedApiKey(adapter);

    await expect(adapter.runSyncToEnv()).rejects.toThrow('sync.target must be within the project directory');
  });

  it('blocks absolute sync targets at runtime guard', async () => {
    const unsafeConfig = {
      ...buildConfig('.env'),
      sync: {
        ...buildConfig('.env').sync,
        target: path.resolve(os.tmpdir(), 'absolute-target.env'),
      },
    } as EnvCPConfig;

    const adapter = new TestAdapter(unsafeConfig, tmpDir);
    await adapter.init();
    await seedApiKey(adapter);

    await expect(adapter.runSyncToEnv()).rejects.toThrow('sync.target must be within the project directory');
  });
});
