import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import { BaseAdapter } from '../src/adapters/base';
import { parseEnv } from '../src/utils/fs';
import { EnvCPConfig, EnvCPConfigSchema, Variable } from '../src/types';

class TestAdapter extends BaseAdapter {
  protected registerTools(): void {
    this.registerDefaultTools();
  }

  async seedVariable(variable: Variable): Promise<void> {
    await this.storage.set(variable.name, variable);
  }

  // Expose protected methods for testing
  runListVariables(args: { tags?: string[] }) { return this.listVariables(args); }
  runGetVariable(args: { name: string; show_value?: boolean }) { return this.getVariable(args); }
  runSetVariable(args: any) { return this.setVariable(args); }
  runDeleteVariable(args: { name: string }) { return this.deleteVariable(args); }
  runAddToEnv(args: { name: string; env_file?: string }) { return this.addToEnv(args); }
  runCheckAccess(args: { name: string }) { return this.checkAccess(args); }
  runSyncToEnv() { return this.syncToEnv(); }
  runRunCommand(args: { command: string; variables: string[] }) { return this.runCommand(args); }
  runParseCommand(cmd: string) { return (this as any).parseCommand(cmd); }
}

const now = new Date().toISOString();

function makeConfig(overrides: Record<string, unknown> = {}): EnvCPConfig {
  return EnvCPConfigSchema.parse({
    access: {
      allow_ai_read: true,
      allow_ai_write: true,
      allow_ai_delete: true,
      allow_ai_export: true,
      allow_ai_execute: true,
      allow_ai_active_check: true,
      require_user_reference: false,
      require_confirmation: false,
      mask_values: false,
      blacklist_patterns: [],
      ...overrides,
    },
    encryption: { enabled: false },
    storage: { encrypted: false, path: '.envcp/store.json' },
    sync: { enabled: true, target: '.env' },
  });
}

describe('BaseAdapter tool operations', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-base-'));
    adapter = new TestAdapter(makeConfig(), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('listVariables', () => {
    it('throws when AI read is disabled', async () => {
      const a = new TestAdapter(makeConfig({ allow_ai_read: false }), tmpDir);
      await a.init();
      await expect(a.runListVariables({})).rejects.toThrow('AI read access is disabled');
    });

    it('throws when active check is disabled', async () => {
      const a = new TestAdapter(makeConfig({ allow_ai_active_check: false }), tmpDir);
      await a.init();
      await expect(a.runListVariables({})).rejects.toThrow('AI active check is disabled');
    });

    it('lists variables', async () => {
      await adapter.seedVariable({ name: 'A', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true });
      await adapter.seedVariable({ name: 'B', value: '2', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.runListVariables({});
      expect(result.count).toBe(2);
      expect(result.variables).toContain('A');
    });

    it('filters by tags', async () => {
      await adapter.seedVariable({ name: 'A', value: '1', encrypted: false, created: now, updated: now, sync_to_env: true, tags: ['db'] });
      await adapter.seedVariable({ name: 'B', value: '2', encrypted: false, created: now, updated: now, sync_to_env: true, tags: ['api'] });
      const result = await adapter.runListVariables({ tags: ['db'] });
      expect(result.count).toBe(1);
      expect(result.variables).toEqual(['A']);
    });

    it('respects blacklist', async () => {
      const a = new TestAdapter(makeConfig({ blacklist_patterns: ['SECRET_*'] }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'SECRET_KEY', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      await a.seedVariable({ name: 'APP_KEY', value: 'y', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await a.runListVariables({});
      expect(result.variables).toEqual(['APP_KEY']);
    });
  });

  describe('getVariable', () => {
    it('throws when AI read is disabled', async () => {
      const a = new TestAdapter(makeConfig({ allow_ai_read: false }), tmpDir);
      await a.init();
      await expect(a.runGetVariable({ name: 'X' })).rejects.toThrow('AI read access is disabled');
    });

    it('rejects invalid variable names', async () => {
      await expect(adapter.runGetVariable({ name: '123bad' })).rejects.toThrow('Invalid variable name');
      await expect(adapter.runGetVariable({ name: '../etc/passwd' })).rejects.toThrow('Invalid variable name');
    });

    it('throws when variable not found', async () => {
      await expect(adapter.runGetVariable({ name: 'MISSING' })).rejects.toThrow("Variable 'MISSING' not found");
    });

    it('throws when blacklisted', async () => {
      const a = new TestAdapter(makeConfig({ blacklist_patterns: ['SECRET_*'] }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'SECRET_KEY', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      await expect(a.runGetVariable({ name: 'SECRET_KEY' })).rejects.toThrow('blacklisted');
    });

    it('throws when access denied', async () => {
      const a = new TestAdapter(makeConfig({ denied_patterns: ['DENY_*'] }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'DENY_THIS', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      await expect(a.runGetVariable({ name: 'DENY_THIS' })).rejects.toThrow('Access denied');
    });

    it('returns masked value when show_value is not set', async () => {
      await adapter.seedVariable({ name: 'KEY', value: 'supersecretvalue', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.runGetVariable({ name: 'KEY' });
      expect(result.value).toContain('*');
    });

    it('reveals value when show_value=true and mask_values=false', async () => {
      await adapter.seedVariable({ name: 'KEY2', value: 'supersecretvalue', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.runGetVariable({ name: 'KEY2', show_value: true });
      expect(result.value).toBe('supersecretvalue');
    });

    it('masks value even with show_value when mask_values is true', async () => {
      const a = new TestAdapter(makeConfig({ mask_values: true }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'KEY', value: 'supersecretvalue', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await a.runGetVariable({ name: 'KEY', show_value: true });
      expect(result.value).toContain('*');
    });
  });

  describe('setVariable', () => {
    it('throws when AI write is disabled', async () => {
      const a = new TestAdapter(makeConfig({ allow_ai_write: false }), tmpDir);
      await a.init();
      await expect(a.runSetVariable({ name: 'X', value: 'v' })).rejects.toThrow('AI write access is disabled');
    });

    it('rejects invalid variable names', async () => {
      await expect(adapter.runSetVariable({ name: '123bad', value: 'v' })).rejects.toThrow('Invalid variable name');
    });

    it('rejects blacklisted names', async () => {
      const a = new TestAdapter(makeConfig({ blacklist_patterns: ['SECRET_*'] }), tmpDir);
      await a.init();
      await expect(a.runSetVariable({ name: 'SECRET_KEY', value: 'v' })).rejects.toThrow('blacklisted');
    });

    it('creates a new variable', async () => {
      const result = await adapter.runSetVariable({ name: 'NEW_VAR', value: 'hello', tags: ['test'] });
      expect(result.success).toBe(true);
      expect(result.message).toContain('created');
    });

    it('updates an existing variable', async () => {
      await adapter.seedVariable({ name: 'EXISTING', value: 'old', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.runSetVariable({ name: 'EXISTING', value: 'new' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('updated');
    });

    it('updates existing protected variable when variable_password is provided', async () => {
      await adapter.runSetVariable({
        name: 'PROTECTED_UPD',
        value: 'secret-v1',
        protect: true,
        variable_password: 'pw-123',
      });

      const result = await adapter.runSetVariable({
        name: 'PROTECTED_UPD',
        value: 'secret-v2',
        variable_password: 'pw-123',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('updated');
    });
  });

  describe('deleteVariable', () => {
    it('throws when AI delete is disabled', async () => {
      const a = new TestAdapter(makeConfig({ allow_ai_delete: false }), tmpDir);
      await a.init();
      await expect(a.runDeleteVariable({ name: 'X' })).rejects.toThrow('AI delete access is disabled');
    });

    it('rejects invalid variable names', async () => {
      await expect(adapter.runDeleteVariable({ name: '123bad' })).rejects.toThrow('Invalid variable name');
    });

    it('deletes existing variable', async () => {
      await adapter.seedVariable({ name: 'DEL', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.runDeleteVariable({ name: 'DEL' });
      expect(result.success).toBe(true);
    });

    it('returns false for non-existent variable', async () => {
      const result = await adapter.runDeleteVariable({ name: 'NOPE' });
      expect(result.success).toBe(false);
    });
  });

  describe('addToEnv', () => {
    it('adds a variable to .env file', async () => {
      await adapter.seedVariable({ name: 'MY_VAR', value: 'hello', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.runAddToEnv({ name: 'MY_VAR' });
      expect(result.success).toBe(true);
      const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
      expect(content).toContain('MY_VAR=hello');
    });

    it('updates existing variable in .env file', async () => {
      await fs.writeFile(path.join(tmpDir, '.env'), 'MY_VAR=old\n');
      await adapter.seedVariable({ name: 'MY_VAR', value: 'new', encrypted: false, created: now, updated: now, sync_to_env: true });
      await adapter.runAddToEnv({ name: 'MY_VAR' });
      const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
      expect(content).toContain('MY_VAR=new');
      expect(content).not.toContain('MY_VAR=old');
    });

    it('throws for non-existent variable', async () => {
      await expect(adapter.runAddToEnv({ name: 'MISSING' })).rejects.toThrow('not found');
    });

    it('rejects blacklisted variable', async () => {
      const a = new TestAdapter(makeConfig({ blacklist_patterns: ['SECRET_*'] }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'SECRET_KEY', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      await expect(a.runAddToEnv({ name: 'SECRET_KEY' })).rejects.toThrow('blacklisted');
    });

    it('blocks path traversal in env_file', async () => {
      await adapter.seedVariable({ name: 'MY_VAR', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      await expect(adapter.runAddToEnv({ name: 'MY_VAR', env_file: '../../etc/evil' })).rejects.toThrow('within the project directory');
    });

    it('blocks sibling-directory bypass in env_file', async () => {
      await adapter.seedVariable({ name: 'MY_VAR', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      const relative = path.relative(tmpDir, tmpDir + '-evil/.env');
      await expect(adapter.runAddToEnv({ name: 'MY_VAR', env_file: relative })).rejects.toThrow('within the project directory');
    });

    it('blocks absolute path outside project in env_file', async () => {
      await adapter.seedVariable({ name: 'MY_VAR', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      await expect(adapter.runAddToEnv({ name: 'MY_VAR', env_file: '/tmp/evil.env' })).rejects.toThrow('within the project directory');
    });

    it('allows nested env_file within project', async () => {
      await adapter.seedVariable({ name: 'MY_VAR', value: 'nested', encrypted: false, created: now, updated: now, sync_to_env: true });
      await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
      const result = await adapter.runAddToEnv({ name: 'MY_VAR', env_file: 'config/.env.local' });
      expect(result.success).toBe(true);
      const content = await fs.readFile(path.join(tmpDir, 'config', '.env.local'), 'utf8');
      expect(content).toContain('MY_VAR=nested');
    });

    it('blocks in-project symlink pointing outside project', async () => {
      await adapter.seedVariable({ name: 'MY_VAR', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-outside-'));
      try {
        await fs.symlink(path.join(outsideDir, 'leaked.env'), path.join(tmpDir, 'leak'));
        await expect(adapter.runAddToEnv({ name: 'MY_VAR', env_file: 'leak' })).rejects.toThrow('within the project directory');
        await expect(pathExists(path.join(outsideDir, 'leaked.env'))).resolves.toBe(false);
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('quotes values that need quoting', async () => {
      await adapter.seedVariable({ name: 'SPACED', value: 'hello world', encrypted: false, created: now, updated: now, sync_to_env: true });
      await adapter.runAddToEnv({ name: 'SPACED' });
      const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
      expect(content).toContain('SPACED="hello world"');
    });
  });

  describe('checkAccess', () => {
    it('rejects invalid variable names', async () => {
      await expect(adapter.runCheckAccess({ name: '123bad' })).rejects.toThrow('Invalid variable name');
    });

    it('returns accessible for valid variable', async () => {
      await adapter.seedVariable({ name: 'APP_KEY', value: 'v', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.runCheckAccess({ name: 'APP_KEY' });
      expect(result.accessible).toBe(true);
    });

    it('returns not accessible for blacklisted variable', async () => {
      const a = new TestAdapter(makeConfig({ blacklist_patterns: ['SECRET_*'] }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'SECRET_KEY', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await a.runCheckAccess({ name: 'SECRET_KEY' });
      expect(result.accessible).toBe(false);
    });

    it('returns not accessible for non-existent variable', async () => {
      const result = await adapter.runCheckAccess({ name: 'MISSING' });
      expect(result.accessible).toBe(false);
    });
  });

  describe('getToolDefinitions', () => {
    it('returns all registered tools', () => {
      const tools = adapter.getToolDefinitions();
      expect(tools.length).toBe(9);
      const names = tools.map(t => t.name);
      expect(names).toContain('envcp_list');
      expect(names).toContain('envcp_get');
      expect(names).toContain('envcp_set');
      expect(names).toContain('envcp_delete');
      expect(names).toContain('envcp_sync');
      expect(names).toContain('envcp_run');
      expect(names).toContain('envcp_add_to_env');
      expect(names).toContain('envcp_check_access');
      expect(names).toContain('envcp_logs');
    });
  });

  describe('constructor with password', () => {
    it('sets password on storage when provided', async () => {
      const a = new TestAdapter(EnvCPConfigSchema.parse({
        access: { allow_ai_read: true, allow_ai_active_check: true },
        encryption: { enabled: false },
        storage: { encrypted: false, path: '.envcp/store.json' },
      }), tmpDir, 'mypass');
      // No error — password is set
      expect(a).toBeDefined();
    });
  });

  describe('callTool', () => {
    it('throws for unknown tool', async () => {
      await expect(adapter.callTool('nonexistent', {})).rejects.toThrow('Unknown tool');
    });

    it('throws when session locked (encrypted mode)', async () => {
      const a = new TestAdapter(EnvCPConfigSchema.parse({
        access: { allow_ai_read: true, allow_ai_active_check: true },
        encryption: { enabled: true },
        storage: { encrypted: true, path: '.envcp/store.enc' },
      }), tmpDir);
      await a.init();
      await expect(a.callTool('envcp_list', {})).rejects.toThrow('Session locked');
    });

    it('calls envcp_sync via callTool handler', async () => {
      const a = new TestAdapter(EnvCPConfigSchema.parse({
        access: { allow_ai_read: true, allow_ai_write: true, allow_ai_export: true, allow_ai_active_check: true },
        encryption: { enabled: false },
        storage: { encrypted: false, path: '.envcp/store.json' },
        sync: { enabled: true, target: '.env' },
      }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'SYNC', value: 'v', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await a.callTool('envcp_sync', {});
      expect(result.success).toBe(true);
    });

    it('calls envcp_run via callTool handler', async () => {
      const a = new TestAdapter(makeConfig({ allowed_commands: ['echo'] }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'RUN_V', value: 'hi', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await a.callTool('envcp_run', { command: 'echo test', variables: ['RUN_V'] });
      expect(result.stdout).toContain('test');
    });

    it('calls envcp_add_to_env via callTool handler', async () => {
      await adapter.seedVariable({ name: 'ADD_V', value: 'val', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.callTool('envcp_add_to_env', { name: 'ADD_V' });
      expect(result.success).toBe(true);
    });

    it('calls envcp_check_access via callTool handler', async () => {
      await adapter.seedVariable({ name: 'CHECK_V', value: 'v', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.callTool('envcp_check_access', { name: 'CHECK_V' });
      expect(result.accessible).toBe(true);
    });
  });

  describe('syncToEnv', () => {
    it('throws when AI export is disabled', async () => {
      const a = new TestAdapter(makeConfig({ allow_ai_export: false }), tmpDir);
      await a.init();
      await expect(a.runSyncToEnv()).rejects.toThrow('AI export access is disabled');
    });

    it('throws when sync is disabled', async () => {
      const a = new TestAdapter(EnvCPConfigSchema.parse({
        access: { allow_ai_export: true },
        encryption: { enabled: false },
        storage: { encrypted: false, path: '.envcp/store.json' },
        sync: { enabled: false },
      }), tmpDir);
      await a.init();
      await expect(a.runSyncToEnv()).rejects.toThrow('Sync is disabled');
    });

    it('excludes blacklisted and sync_to_env=false variables', async () => {
      const a = new TestAdapter(makeConfig({ blacklist_patterns: ['SECRET_*'] }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'SECRET_KEY', value: 'hidden', encrypted: false, created: now, updated: now, sync_to_env: true });
      await a.seedVariable({ name: 'APP_KEY', value: 'visible', encrypted: false, created: now, updated: now, sync_to_env: true });
      await a.seedVariable({ name: 'NOSYNC', value: 'nope', encrypted: false, created: now, updated: now, sync_to_env: false });
      await a.runSyncToEnv();
      const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
      expect(content).toContain('APP_KEY=visible');
      expect(content).not.toContain('SECRET_KEY');
      expect(content).not.toContain('NOSYNC');
    });

    it('writes header when configured', async () => {
      const a = new TestAdapter(EnvCPConfigSchema.parse({
        access: { allow_ai_export: true },
        encryption: { enabled: false },
        storage: { encrypted: false, path: '.envcp/store.json' },
        sync: { enabled: true, target: '.env', header: '# Auto-generated' },
      }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'X', value: 'y', encrypted: false, created: now, updated: now, sync_to_env: true });
      await a.runSyncToEnv();
      const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
      expect(content).toContain('# Auto-generated');
    });

    it('respects sync.exclude patterns while exporting', async () => {
      const a = new TestAdapter(EnvCPConfigSchema.parse({
        access: { allow_ai_export: true },
        encryption: { enabled: false },
        storage: { encrypted: false, path: '.envcp/store.json' },
        sync: { enabled: true, target: '.env', exclude: ['SECRET_*'] },
      }), tmpDir);
      await a.init();

      await a.seedVariable({ name: 'SECRET_TOKEN', value: 'hidden', encrypted: false, created: now, updated: now, sync_to_env: true });
      await a.seedVariable({ name: 'PUBLIC_TOKEN', value: 'visible', encrypted: false, created: now, updated: now, sync_to_env: true });

      await a.runSyncToEnv();
      const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
      expect(content).toContain('PUBLIC_TOKEN=visible');
      expect(content).not.toContain('SECRET_TOKEN');
    });
  });

  describe('runCommand', () => {
    it('throws when AI execute is disabled', async () => {
      const a = new TestAdapter(makeConfig({ allow_ai_execute: false }), tmpDir);
      await a.init();
      await expect(a.runRunCommand({ command: 'echo hi', variables: [] })).rejects.toThrow('AI command execution is disabled');
    });

    it('rejects shell metacharacters', async () => {
      await expect(adapter.runRunCommand({ command: 'echo; rm -rf /', variables: [] })).rejects.toThrow('disallowed shell metacharacters');
    });

    it('rejects commands not in allowed list', async () => {
      const a = new TestAdapter(makeConfig({ allowed_commands: ['env'] }), tmpDir);
      await a.init();
      await expect(a.runRunCommand({ command: 'cat /etc/passwd', variables: [] })).rejects.toThrow('not in the allowed commands list');
    });

    it('rejects mismatched quotes', async () => {
      await expect(adapter.runRunCommand({ command: 'echo "hello', variables: [] })).rejects.toThrow('Mismatched quotes');
    });

    it('runs a valid command and captures output', async () => {
      const result = await adapter.runRunCommand({ command: 'echo hello', variables: [] });
      expect(result.stdout).toContain('hello');
      expect(result.exitCode).toBe(0);
    });

    it('captures stderr output from command failures', async () => {
      const a = new TestAdapter(makeConfig({ allowed_commands: ['cat'] }), tmpDir);
      await a.init();
      const result = await a.runRunCommand({ command: 'cat /definitely_missing_envcp_file', variables: [] });
      expect(result.stderr.length).toBeGreaterThan(0);
      expect(result.exitCode).not.toBe(0);
    });

    it('handles single-quoted arguments', async () => {
      const result = await adapter.runRunCommand({ command: "echo 'hello world'", variables: [] });
      expect(result.stdout).toContain('hello world');
    });

    it('calls envcp_delete via callTool handler', async () => {
      await adapter.seedVariable({ name: 'DEL_CT', value: 'x', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.callTool('envcp_delete', { name: 'DEL_CT' });
      expect(result.success).toBe(true);
    });

    it('excludes blacklisted variables from injection', async () => {
      const a = new TestAdapter(makeConfig({ blacklist_patterns: ['SECRET_*'], allowed_commands: ['echo'] }), tmpDir);
      await a.init();
      await a.seedVariable({ name: 'SECRET_KEY', value: 'hidden', encrypted: false, created: now, updated: now, sync_to_env: true });
      await a.seedVariable({ name: 'APP_KEY', value: 'visible', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await a.runRunCommand({ command: 'echo test', variables: ['SECRET_KEY', 'APP_KEY'] });
      expect(result.stderr).toContain('Excluded variables by policy');
      expect(result.stderr).toContain('SECRET_KEY');
    });

    it('logs run start and exit to audit trail (issue #147)', async () => {
      await adapter.seedVariable({ name: 'AUDIT_VAR', value: 'auditval', encrypted: false, created: now, updated: now, sync_to_env: true });
      const result = await adapter.runRunCommand({ command: 'echo audit', variables: ['AUDIT_VAR'] });
      expect(result.exitCode).toBe(0);

      const date = new Date().toISOString().split('T')[0];
      const logFile = path.join(tmpDir, '.envcp', 'logs', `operations-${date}.log`);
      const content = await fs.readFile(logFile, 'utf8');
      const entries = content.trim().split('\n').map(l => JSON.parse(l)) as Array<{ operation: string; variable?: string; message?: string }>;

      const startEntry = entries.find(e => e.operation === 'run' && e.message?.includes('Starting:'));
      expect(startEntry).toBeDefined();
      expect(startEntry!.variable).toBe('echo audit');
      expect(startEntry!.message).toContain('AUDIT_VAR');

      const exitEntry = entries.find(e => e.operation === 'run' && e.message?.includes('Exited'));
      expect(exitEntry).toBeDefined();
      expect(exitEntry!.message).toContain('code 0');
    });
  });

  describe('ensurePassword', () => {
    it('skips password check in unencrypted mode', async () => {
      const a = new TestAdapter(EnvCPConfigSchema.parse({
        access: { allow_ai_read: true, allow_ai_active_check: true },
        encryption: { enabled: false },
        storage: { encrypted: false, path: '.envcp/store.json' },
      }), tmpDir);
      await a.init();
      const result = await a.callTool('envcp_list', {});
      expect(result.count).toBe(0);
    });

    it('uses session password when session is valid (encrypted mode)', async () => {
      // Create a valid session first
      const { SessionManager } = await import('../src/utils/session');
      const sessionPath = path.join(tmpDir, '.envcp', '.session');
      await ensureDir(path.dirname(sessionPath));
      const sm = new SessionManager(sessionPath, 30, 5);
      await sm.init();
      await sm.create('testpass');

      // Create encrypted adapter — the session manager will find the session
      const a = new TestAdapter(EnvCPConfigSchema.parse({
        access: { allow_ai_read: true, allow_ai_active_check: true },
        encryption: { enabled: true },
        storage: { encrypted: true, path: '.envcp/store.enc' },
      }), tmpDir);
      await a.init();

      // Manually load the session into the adapter's session manager
      const adapterSM = (a as any).sessionManager as InstanceType<typeof SessionManager>;
      await adapterSM.load('testpass');

      // Now callTool should use the session password (lines 158-159)
      const result = await a.callTool('envcp_list', {});
      expect(result.count).toBe(0);
    });
  });
});

describe('parseEnv', () => {
  it('strips single-quoted values', () => {
    const result = parseEnv("KEY='hello world'\nOTHER=value");
    expect(result.KEY).toBe('hello world');
    expect(result.OTHER).toBe('value');
  });

  it('strips double-quoted values', () => {
    const result = parseEnv('KEY="hello world"');
    expect(result.KEY).toBe('hello world');
  });

  it('skips lines without = sign — line 25 (eqIndex === -1 branch)', () => {
    const result = parseEnv('VALID=value\nno-equals-here\nOTHER=ok');
    expect(result.VALID).toBe('value');
    expect(result.OTHER).toBe('ok');
    expect(Object.keys(result)).not.toContain('no-equals-here');
  });
});

describe('BaseAdapter parseCommand edge cases', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-parse-'));
    adapter = new TestAdapter(makeConfig({ allowed_commands: ['echo', 'env'] }), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('handles double space (empty token skipped) — line 647', () => {
    const result = adapter.runParseCommand('echo  hello');
    expect(result.program).toBe('echo');
    expect(result.args).toEqual(['hello']);
  });

  it('handles trailing space (no trailing empty token) — line 655', () => {
    const result = adapter.runParseCommand('echo hello ');
    expect(result.program).toBe('echo');
    expect(result.args).toEqual(['hello']);
  });

  it('throws on mismatched single quote — line 658', () => {
    expect(() => adapter.runParseCommand("echo 'hello")).toThrow('Mismatched quotes');
  });

  it('throws on mismatched double quote — line 658', () => {
    expect(() => adapter.runParseCommand('echo "hello')).toThrow('Mismatched quotes');
  });

  it('handles single-quoted token with spaces', () => {
    const result = adapter.runParseCommand("echo 'hello world'");
    expect(result.args).toEqual(['hello world']);
  });

  it('handles double-quoted token', () => {
    const result = adapter.runParseCommand('echo "hello world"');
    expect(result.args).toEqual(['hello world']);
  });
});

describe('BaseAdapter syncToEnv value quoting — line 530', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-syncquote-'));
    adapter = new TestAdapter(makeConfig(), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('quotes values containing spaces', async () => {
    await adapter.seedVariable({ name: 'SPACE_VAR', value: 'hello world', encrypted: false, created: now, updated: now, sync_to_env: true });
    await adapter.runSyncToEnv();
    const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
    expect(content).toContain('SPACE_VAR="hello world"');
  });

  it('quotes values containing hash character', async () => {
    await adapter.seedVariable({ name: 'HASH_VAR', value: 'val#ue', encrypted: false, created: now, updated: now, sync_to_env: true });
    await adapter.runSyncToEnv();
    const content = await fs.readFile(path.join(tmpDir, '.env'), 'utf8');
    expect(content).toContain('HASH_VAR="val#ue"');
  });
});

describe('BaseAdapter runCommand variable not in storage — line 786', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-missingvar-'));
    adapter = new TestAdapter(makeConfig({ allowed_commands: ['env'] }), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('runs command without injecting missing variable', async () => {
    const result = await adapter.runRunCommand({ command: 'env', variables: ['NONEXISTENT_XYZ_VAR'] });
    expect(result.stdout).not.toContain('NONEXISTENT_XYZ_VAR=');
  });
});

describe('BaseAdapter checkRootDelete -recursive variant — line 688', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-recursive-'));
    adapter = new TestAdapter(makeConfig({
      allowed_commands: ['rm'],
      run_safety: { disallow_root_delete: true, disallow_path_manipulation: false, require_command_whitelist: false },
    }), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects rm with -recursive (single-dash long form) targeting /', async () => {
    await expect(
      adapter.runRunCommand({ command: 'rm -recursive /', variables: [] }),
    ).rejects.toThrow(/disallow_root_delete/i);
  });
});

describe('parseCommand edge cases', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-parse-'));
    adapter = new TestAdapter(makeConfig({ allow_ai_execute: true }), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws on unclosed double quote', () => {
    expect(() => adapter.runParseCommand('echo "hello')).toThrow('Mismatched quotes');
  });

  it('throws on unclosed single quote', () => {
    expect(() => adapter.runParseCommand("echo 'world")).toThrow('Mismatched quotes');
  });
});

describe('validateCommand with command_blacklist', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when command matches a user-configured blacklist pattern', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-bl-'));
    const adapter = new TestAdapter(
      makeConfig({ allow_ai_execute: true, command_blacklist: ['danger'] }),
      tmpDir,
    );
    await adapter.init();
    await expect(
      adapter.runRunCommand({ command: 'echo danger here', variables: [] }),
    ).rejects.toThrow('blacklisted pattern');
  });
});

describe('runCommand with scrub_output disabled', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns raw output when scrub_output is false', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-noscrub-'));
    const cfg = makeConfig({
      allow_ai_execute: true,
      allowed_commands: ['echo'],
      run_safety: { disallow_root_delete: true, disallow_path_manipulation: true, require_command_whitelist: false, scrub_output: false, redact_patterns: [] },
    });
    const adapter = new TestAdapter(cfg, tmpDir);
    await adapter.init();
    await adapter.callTool('envcp_set', { name: 'RAWVAL', value: 'should-appear-raw' });
    const result = await adapter.runRunCommand({ command: 'echo should-appear-raw', variables: [] }) as { stdout: string };
    // With scrub disabled, raw value may appear in output
    expect(result.stdout).toContain('should-appear-raw');
  });

  it('applies custom redact_patterns from config', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-customredact-'));
    const cfg = makeConfig({
      allow_ai_execute: true,
      allowed_commands: ['echo'],
      run_safety: {
        disallow_root_delete: true,
        disallow_path_manipulation: true,
        require_command_whitelist: false,
        scrub_output: true,
        redact_patterns: ['CUSTOM_[A-Z]+']
      },
    });
    const adapter = new TestAdapter(cfg, tmpDir);
    await adapter.init();
    const result = await adapter.runRunCommand({ command: 'echo CUSTOM_SECRET_VALUE', variables: [] }) as { stdout: string };
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stdout).not.toContain('CUSTOM_SECRET_VALUE');
  });
});

describe('BaseAdapter constructor with custom session config', () => {
  it('uses custom session timeout_minutes and max_extensions from config', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sess-'));
    try {
      const cfg = EnvCPConfigSchema.parse({
        access: { allow_ai_read: true, allow_ai_write: true, allow_ai_delete: true, allow_ai_export: true, allow_ai_active_check: true, require_user_reference: false, require_confirmation: false, mask_values: false, blacklist_patterns: [] },
        encryption: { enabled: false },
        storage: { encrypted: false, path: '.envcp/store.json' },
        session: { timeout_minutes: 10, max_extensions: 2, path: '.envcp/.session' },
        sync: { enabled: false },
      });
      const adapter = new TestAdapter(cfg, tmpDir);
      await adapter.init();
      expect(adapter).toBeDefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('parseCommand — empty command (line 657)', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-empty-cmd-'));
    adapter = new TestAdapter(makeConfig({ allow_ai_execute: true }), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws Empty command error for blank string', () => {
    expect(() => adapter.runParseCommand('')).toThrow('Empty command');
  });

  it('throws Empty command error for whitespace-only string', () => {
    expect(() => adapter.runParseCommand('   ')).toThrow('Empty command');
  });
});

describe('checkRootDelete — --recursive flag (line 687 branch)', () => {
  let tmpDir: string;
  let adapter: TestAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rootdel-'));
    adapter = new TestAdapter(
      makeConfig({ allow_ai_execute: true, allowed_commands: ['rm'] }),
      tmpDir,
    );
    await adapter.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('blocks rm --recursive / (long flag branch)', async () => {
    await expect(
      adapter.runRunCommand({ command: 'rm --recursive /', variables: [] }),
    ).rejects.toThrow('root filesystem');
  });

  it('allows rm -recursive when root-delete protection is disabled', async () => {
    const a = new TestAdapter(makeConfig({
      allowed_commands: ['rm'],
      run_safety: {
        disallow_root_delete: false,
        disallow_path_manipulation: false,
        require_command_whitelist: false,
        scrub_output: true,
        redact_patterns: [],
      },
    }), tmpDir);
    await a.init();

    const result = await a.runRunCommand({ command: 'rm -recursive /', variables: [] });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBeDefined();
  });

  it('handles dangling symlink env path by resolving readlink target', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-canon-out-'));
    try {
      const linkPath = path.join(tmpDir, 'dangling.env');
      const targetPath = path.join(outsideDir, 'target.env');
      await fs.symlink(targetPath, linkPath);

      const result = await (adapter as any).canonicalizeEnvPath(linkPath);
      expect(result.projectRootReal).toBe(tmpDir);
      expect(result.envPathReal).toBe(targetPath);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
