import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { RESTAdapter } from '../src/adapters/rest';
import { EnvCPConfig, OperationLog } from '../src/types';

type MakeConfigOpts = {
  allow_ai_logs?: boolean;
  logs_default_role?: 'full' | 'own_sessions' | 'readonly' | 'none';
  logs_roles?: Record<string, 'full' | 'own_sessions' | 'readonly' | 'none'>;
};

const makeConfig = (opts: MakeConfigOpts = {}): EnvCPConfig => ({
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
    allow_ai_logs: opts.allow_ai_logs ?? false,
    logs_default_role: opts.logs_default_role ?? 'full',
    logs_roles: opts.logs_roles ?? {},
    require_user_reference: false,
    allowed_commands: ['env'],
    require_confirmation: false,
    mask_values: false,
    audit_log: true,
    blacklist_patterns: [],
    command_blacklist: [],
    run_safety: {
      disallow_root_delete: false,
      disallow_path_manipulation: false,
      require_command_whitelist: false,
    },
  } as unknown as EnvCPConfig['access'],
  sync: { enabled: false, target: '.env', exclude: [], format: 'dotenv' },
  session: { enabled: false, timeout_minutes: 30, max_extensions: 5, path: '.envcp/.session' },
  encryption: { enabled: false },
  security: { mode: 'recoverable', recovery_file: '.envcp/.recovery' },
  password: { min_length: 1, require_complexity: false, allow_numeric_only: true, allow_single_char: true },
} as unknown as EnvCPConfig);

async function seedLog(logDir: string, date: string, entries: Partial<OperationLog>[]): Promise<void> {
  await fs.mkdir(logDir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify({
    timestamp: `${date}T12:00:00.000Z`,
    source: 'mcp',
    success: true,
    session_id: '',
    client_id: 'test',
    client_type: 'unit',
    ip: '127.0.0.1',
    ...e,
  }));
  await fs.writeFile(path.join(logDir, `operations-${date}.log`), lines.join('\n') + '\n');
}

describe('envcp_logs MCP tool (issue #204 phase B)', () => {
  let tempDir: string;
  const today = new Date().toISOString().slice(0, 10);

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('registers envcp_logs in the tool list', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-tool-'));
    const adapter = new RESTAdapter(makeConfig(), tempDir);
    await adapter.init();

    const tools = adapter.getToolDefinitions().map((t) => t.name);
    expect(tools).toContain('envcp_logs');
  });

  it('rejects when allow_ai_logs is false', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-tool-'));
    const adapter = new RESTAdapter(makeConfig({ allow_ai_logs: false }), tempDir);
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'FOO', message: 'read' },
    ]);

    await expect(adapter.callTool('envcp_logs', {})).rejects.toThrow(/allow_ai_logs/);
  });

  it('returns entries when allow_ai_logs is true', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-tool-'));
    const adapter = new RESTAdapter(makeConfig({ allow_ai_logs: true }), tempDir);
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'FOO', message: 'read' },
      { operation: 'delete', variable: 'BAR', message: 'gone' },
    ]);

    const result = await adapter.callTool('envcp_logs', { date: today }) as { entries: OperationLog[]; count: number };
    expect(result.count).toBe(2);
    expect(result.entries.map((e) => e.variable)).toEqual(['FOO', 'BAR']);
  });

  it('applies operation filter', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-tool-'));
    const adapter = new RESTAdapter(makeConfig({ allow_ai_logs: true }), tempDir);
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'FOO' },
      { operation: 'delete', variable: 'BAR' },
      { operation: 'get', variable: 'BAZ' },
    ]);

    const result = await adapter.callTool('envcp_logs', { date: today, operation: 'get' }) as { entries: OperationLog[]; count: number };
    expect(result.count).toBe(2);
    expect(result.entries.every((e) => e.operation === 'get')).toBe(true);
  });

  it('caps tail at 100', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-tool-'));
    const adapter = new RESTAdapter(makeConfig({ allow_ai_logs: true }), tempDir);
    await adapter.init();

    const entries = Array.from({ length: 250 }, (_, i) => ({
      operation: 'get' as const,
      variable: `V${i}`,
    }));
    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, entries);

    const result = await adapter.callTool('envcp_logs', { date: today, tail: 500 }) as { entries: OperationLog[]; count: number };
    expect(result.count).toBe(100);
    expect(result.entries[result.entries.length - 1].variable).toBe('V249');
    expect(result.entries[0].variable).toBe('V150');
  });

  it('filters by success boolean', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-tool-'));
    const adapter = new RESTAdapter(makeConfig({ allow_ai_logs: true }), tempDir);
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'OK', success: true },
      { operation: 'get', variable: 'FAIL', success: false },
    ]);

    const result = await adapter.callTool('envcp_logs', { date: today, success: false }) as { entries: OperationLog[]; count: number };
    expect(result.count).toBe(1);
    expect(result.entries[0].variable).toBe('FAIL');
  });
});

describe('envcp_logs role enforcement (issue #204 phase C)', () => {
  let tempDir: string;
  const today = new Date().toISOString().slice(0, 10);

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('role "full" returns all entries regardless of client_id', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-role-'));
    const adapter = new RESTAdapter(
      makeConfig({ allow_ai_logs: true, logs_roles: { alice: 'full' } }),
      tempDir,
    );
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'A', client_id: 'alice' },
      { operation: 'get', variable: 'B', client_id: 'bob' },
      { operation: 'get', variable: 'C', client_id: 'carol' },
    ]);

    const result = await adapter.callTool('envcp_logs', { date: today }, 'alice') as {
      entries: OperationLog[]; count: number; role: string;
    };
    expect(result.role).toBe('full');
    expect(result.count).toBe(3);
  });

  it('role "own_sessions" filters entries to caller\'s client_id only', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-role-'));
    const adapter = new RESTAdapter(
      makeConfig({ allow_ai_logs: true, logs_roles: { alice: 'own_sessions' } }),
      tempDir,
    );
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'A', client_id: 'alice' },
      { operation: 'get', variable: 'B', client_id: 'bob' },
      { operation: 'get', variable: 'C', client_id: 'alice' },
    ]);

    const result = await adapter.callTool('envcp_logs', { date: today }, 'alice') as {
      entries: OperationLog[]; count: number; role: string;
    };
    expect(result.role).toBe('own_sessions');
    expect(result.count).toBe(2);
    expect(result.entries.every((e) => e.client_id === 'alice')).toBe(true);
  });

  it('role "readonly" returns all entries (read access without filter)', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-role-'));
    const adapter = new RESTAdapter(
      makeConfig({ allow_ai_logs: true, logs_roles: { auditor: 'readonly' } }),
      tempDir,
    );
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'A', client_id: 'alice' },
      { operation: 'get', variable: 'B', client_id: 'bob' },
    ]);

    const result = await adapter.callTool('envcp_logs', { date: today }, 'auditor') as {
      entries: OperationLog[]; count: number; role: string;
    };
    expect(result.role).toBe('readonly');
    expect(result.count).toBe(2);
  });

  it('role "none" rejects access', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-role-'));
    const adapter = new RESTAdapter(
      makeConfig({ allow_ai_logs: true, logs_roles: { untrusted: 'none' } }),
      tempDir,
    );
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'A', client_id: 'alice' },
    ]);

    await expect(
      adapter.callTool('envcp_logs', { date: today }, 'untrusted'),
    ).rejects.toThrow(/role: none/);
  });

  it('default role applies to unmapped clients', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-role-'));
    const adapter = new RESTAdapter(
      makeConfig({
        allow_ai_logs: true,
        logs_default_role: 'own_sessions',
        logs_roles: { cli: 'full' },
      }),
      tempDir,
    );
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'A', client_id: 'unknown-client' },
      { operation: 'get', variable: 'B', client_id: 'someone-else' },
    ]);

    const result = await adapter.callTool('envcp_logs', { date: today }, 'unknown-client') as {
      entries: OperationLog[]; count: number; role: string;
    };
    expect(result.role).toBe('own_sessions');
    expect(result.count).toBe(1);
    expect(result.entries[0].variable).toBe('A');
  });

  it('explicit logs_roles mapping overrides default', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logs-role-'));
    const adapter = new RESTAdapter(
      makeConfig({
        allow_ai_logs: true,
        logs_default_role: 'none',
        logs_roles: { trusted: 'full' },
      }),
      tempDir,
    );
    await adapter.init();

    await seedLog(path.join(tempDir, '.envcp', 'logs'), today, [
      { operation: 'get', variable: 'A', client_id: 'trusted' },
      { operation: 'get', variable: 'B', client_id: 'other' },
    ]);

    const result = await adapter.callTool('envcp_logs', { date: today }, 'trusted') as {
      entries: OperationLog[]; count: number; role: string;
    };
    expect(result.role).toBe('full');
    expect(result.count).toBe(2);

    await expect(
      adapter.callTool('envcp_logs', { date: today }, 'other'),
    ).rejects.toThrow(/role: none/);
  });
});
