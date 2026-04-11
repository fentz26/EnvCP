import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import os from 'os';
import path from 'path';
import { RESTAdapter } from '../src/adapters/rest';
import { EnvCPConfig } from '../src/types';

const makeConfig = (
  patterns?: { allowed?: string[]; denied?: string[]; blacklist?: string[] },
  safety?: {
    command_blacklist?: string[];
    disallow_root_delete?: boolean;
    disallow_path_manipulation?: boolean;
    require_command_whitelist?: boolean;
    allowed_commands?: string[];
  },
): EnvCPConfig => ({
  version: '1.0',
  storage: {
    path: '.envcp/store.json',
    encrypted: false,
  },
  access: {
    allow_ai_read: true,
    allow_ai_write: true,
    allow_ai_delete: true,
    allow_ai_export: true,
    allow_ai_execute: true,
    allow_ai_active_check: true,
    require_user_reference: false,
    allowed_commands: safety?.allowed_commands ?? ['env'],
    require_confirmation: false,
    mask_values: false,
    audit_log: true,
    allowed_patterns: patterns?.allowed,
    denied_patterns: patterns?.denied,
    blacklist_patterns: patterns?.blacklist || [],
    command_blacklist: safety?.command_blacklist ?? [],
    run_safety: {
      disallow_root_delete: safety?.disallow_root_delete ?? false,
      disallow_path_manipulation: safety?.disallow_path_manipulation ?? false,
      require_command_whitelist: safety?.require_command_whitelist ?? false,
    },
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
      await fs.rm(tempDir, { recursive: true, force: true });
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

describe('envcp_run command_blacklist', () => {
  let tempDir: string;
  let adapter: RESTAdapter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-blacklist-'));
    adapter = new RESTAdapter(
      makeConfig(undefined, { command_blacklist: ['mkfs', 'shred'], allowed_commands: ['env', 'echo'] }),
      tempDir,
    );
    await adapter.init();
  });

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects a command matching the blacklist', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'mkfs.ext4 /dev/sda', variables: [] }),
    ).rejects.toThrow(/blacklisted pattern/i);
  });

  it('rejects a blacklisted program regardless of args', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'shred -u myfile', variables: [] }),
    ).rejects.toThrow(/blacklisted pattern/i);
  });

  it('allows commands not on the blacklist', async () => {
    const result = await adapter.callTool('envcp_run', { command: 'echo hello', variables: [] }) as { stdout: string };
    expect(result.stdout.trim()).toBe('hello');
  });

  it('blacklist check is case-insensitive', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'MKFS.ext4 /dev/sda', variables: [] }),
    ).rejects.toThrow(/blacklisted pattern/i);
  });
});

describe('envcp_run disallow_root_delete', () => {
  let tempDir: string;
  let adapter: RESTAdapter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rootdel-'));
    adapter = new RESTAdapter(
      makeConfig(undefined, { disallow_root_delete: true, allowed_commands: ['rm', 'env'] }),
      tempDir,
    );
    await adapter.init();
  });

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects rm -rf /', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'rm -rf /', variables: [] }),
    ).rejects.toThrow(/disallow_root_delete/i);
  });

  it('rejects rm -r /', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'rm -r /', variables: [] }),
    ).rejects.toThrow(/disallow_root_delete/i);
  });

  it('rejects rm --recursive /', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'rm --recursive /', variables: [] }),
    ).rejects.toThrow(/disallow_root_delete/i);
  });

  it('rejects rm -rf /*', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'rm -rf /*', variables: [] }),
    ).rejects.toThrow(/disallow_root_delete/i);
  });

  it('allows rm -rf targeting non-root path', async () => {
    // Should not throw — the safety check only blocks root targets
    // (the actual rm will fail because the temp path is not a real target, but that is OK)
    await expect(
      adapter.callTool('envcp_run', { command: 'rm -rf /tmp/does-not-exist-envcp-test', variables: [] }),
    ).resolves.toBeDefined();
  });
});

describe('envcp_run require_command_whitelist', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects command not in allowed_commands when whitelist is required', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-wl-'));
    const adapter = new RESTAdapter(
      makeConfig(undefined, {
        require_command_whitelist: true,
        allowed_commands: ['env'],
      }),
      tempDir,
    );
    await adapter.init();

    await expect(
      adapter.callTool('envcp_run', { command: 'echo hello', variables: [] }),
    ).rejects.toThrow(/require_command_whitelist/i);
  });

  it('allows command in allowed_commands when whitelist is required', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-wl2-'));
    const adapter = new RESTAdapter(
      makeConfig(undefined, {
        require_command_whitelist: true,
        allowed_commands: ['env', 'echo'],
      }),
      tempDir,
    );
    await adapter.init();

    const result = await adapter.callTool('envcp_run', { command: 'echo hi', variables: [] }) as { stdout: string };
    expect(result.stdout.trim()).toBe('hi');
  });
});

describe('envcp_run disallow_root_delete — path normalization', () => {
  let tempDir: string;
  let adapter: RESTAdapter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rootnorm-'));
    adapter = new RESTAdapter(
      makeConfig(undefined, { disallow_root_delete: true, allowed_commands: ['rm'] }),
      tempDir,
    );
    await adapter.init();
  });

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects rm -rf with double-slash // (normalizes to /)', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'rm -rf //', variables: [] }),
    ).rejects.toThrow(/disallow_root_delete/i);
  });

  it('rejects rm -rf /. (dot in root)', async () => {
    await expect(
      adapter.callTool('envcp_run', { command: 'rm -rf /.', variables: [] }),
    ).rejects.toThrow(/disallow_root_delete/i);
  });
});

describe('envcp_run disallow_path_manipulation', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects when an injected vault variable overrides HOME to /', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-pathman-'));
    const adapter = new RESTAdapter(
      makeConfig(undefined, {
        disallow_path_manipulation: true,
        allowed_commands: ['env'],
      }),
      tempDir,
    );
    await adapter.init();
    // Store a variable named HOME with a dangerous value
    await adapter.callTool('envcp_set', { name: 'HOME', value: '/' });

    await expect(
      adapter.callTool('envcp_run', { command: 'env', variables: ['HOME'] }),
    ).rejects.toThrow(/disallow_path_manipulation/i);
  });

  it('rejects when an injected vault variable sets PATH with directory traversal', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-pathman2-'));
    const adapter = new RESTAdapter(
      makeConfig(undefined, {
        disallow_path_manipulation: true,
        allowed_commands: ['env'],
      }),
      tempDir,
    );
    await adapter.init();
    await adapter.callTool('envcp_set', { name: 'PATH', value: '/usr/bin:../../bin' });

    await expect(
      adapter.callTool('envcp_run', { command: 'env', variables: ['PATH'] }),
    ).rejects.toThrow(/disallow_path_manipulation/i);
  });

  it('allows safe PATH values', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-pathman3-'));
    const adapter = new RESTAdapter(
      makeConfig(undefined, {
        disallow_path_manipulation: true,
        allowed_commands: ['env'],
      }),
      tempDir,
    );
    await adapter.init();
    await adapter.callTool('envcp_set', { name: 'APP_PATH', value: '/usr/local/bin:/usr/bin' });

    // APP_PATH is not a critical key — should inject fine
    const result = await adapter.callTool('envcp_run', { command: 'env', variables: ['APP_PATH'] }) as { stdout: string };
    expect(result.stdout).toContain('APP_PATH=/usr/local/bin:/usr/bin');
  });
});
