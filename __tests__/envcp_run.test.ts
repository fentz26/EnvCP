import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { RESTAdapter } from '../src/adapters/rest';
import { EnvCPConfig } from '../src/types';

const makeConfig = (patterns?: { allowed?: string[]; denied?: string[]; blacklist?: string[] }): EnvCPConfig => ({
  version: '1.0',
  storage: {
    path: '.envcp/store.json',
    encrypted: false,
    algorithm: 'aes-256-gcm',
    compression: false,
  },
  access: {
    allow_ai_read: true,
    allow_ai_write: true,
    allow_ai_delete: true,
    allow_ai_export: true,
    allow_ai_execute: true,
    allow_ai_active_check: true,
    require_user_reference: false,
    allowed_commands: ['env'],
    require_confirmation: false,
    mask_values: false,
    audit_log: true,
    allowed_patterns: patterns?.allowed,
    denied_patterns: patterns?.denied,
    blacklist_patterns: patterns?.blacklist || [],
  },
  sync: {
    enabled: false,
    target: '.env',
    exclude: [],
    format: 'dotenv',
  },
  session: {
    enabled: false,
    timeout_minutes: 30,
    max_extensions: 5,
    path: '.envcp/.session',
  },
  encryption: {
    enabled: false,
  },
  security: {
    mode: 'recoverable',
    recovery_file: '.envcp/.recovery',
  },
  password: {
    min_length: 1,
    require_complexity: false,
    allow_numeric_only: true,
    allow_single_char: true,
  },
});

describe('envcp_run policy filtering', () => {
  let tempDir: string;
  let adapter: RESTAdapter;

  const setup = async (patterns?: { allowed?: string[]; denied?: string[]; blacklist?: string[] }) => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-run-'));
    adapter = new RESTAdapter(makeConfig(), tempDir);
    await adapter.init();

    await adapter.callTool('envcp_set', { name: 'APP_TOKEN', value: 'allowed-value' });
    await adapter.callTool('envcp_set', { name: 'DENY_SECRET', value: 'denied-value' });
    await adapter.callTool('envcp_set', { name: 'SECRET_API_KEY', value: 'blacklisted-value' });

    (adapter as any).config.access.allowed_patterns = patterns?.allowed;
    (adapter as any).config.access.denied_patterns = patterns?.denied;
    (adapter as any).config.access.blacklist_patterns = patterns?.blacklist || [];
  };

  afterEach(async () => {
    if (tempDir) {
      await fs.remove(tempDir);
    }
  });

  it('injects variable allowed by allowed_patterns', async () => {
    await setup({ allowed: ['APP_*'] });

    const result = await adapter.callTool('envcp_run', { command: 'env', variables: ['APP_TOKEN'] }) as { stdout: string; stderr: string };

    expect(result.stdout).toContain('APP_TOKEN=allowed-value');
    expect(result.stderr).toBe('');
  });

  it('excludes variable denied by denied_patterns', async () => {
    await setup({ denied: ['DENY_*'] });

    const result = await adapter.callTool('envcp_run', { command: 'env', variables: ['DENY_SECRET'] }) as { stdout: string; stderr: string };

    expect(result.stdout).not.toContain('DENY_SECRET=denied-value');
    expect(result.stderr).toContain('Excluded variables by policy');
    expect(result.stderr).toContain('DENY_SECRET');
  });

  it('excludes variable blocked by blacklist', async () => {
    await setup({ blacklist: ['SECRET_*'] });

    const result = await adapter.callTool('envcp_run', { command: 'env', variables: ['SECRET_API_KEY'] }) as { stdout: string; stderr: string };

    expect(result.stdout).not.toContain('SECRET_API_KEY=blacklisted-value');
    expect(result.stderr).toContain('Excluded variables by policy');
    expect(result.stderr).toContain('SECRET_API_KEY');
  });

  it('injects only allowed variables for mixed request list', async () => {
    await setup({ allowed: ['APP_*'], denied: ['DENY_*'], blacklist: ['SECRET_*'] });

    const result = await adapter.callTool('envcp_run', {
      command: 'env',
      variables: ['APP_TOKEN', 'DENY_SECRET', 'SECRET_API_KEY'],
    }) as { stdout: string; stderr: string };

    expect(result.stdout).toContain('APP_TOKEN=allowed-value');
    expect(result.stdout).not.toContain('DENY_SECRET=denied-value');
    expect(result.stdout).not.toContain('SECRET_API_KEY=blacklisted-value');
    expect(result.stderr).toContain('DENY_SECRET');
    expect(result.stderr).toContain('SECRET_API_KEY');

    const date = new Date().toISOString().split('T')[0];
    const logPath = path.join(tempDir, '.envcp', 'logs', `operations-${date}.log`);
    const content = await fs.readFile(logPath, 'utf8');

    expect(content).toContain('Excluded from envcp_run due to policy');
    expect(content).toContain('DENY_SECRET');
    expect(content).toContain('SECRET_API_KEY');
  });
});
