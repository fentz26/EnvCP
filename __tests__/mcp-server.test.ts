import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { EnvCPServer } from '../src/mcp/server';
import { BaseAdapter } from '../src/adapters/base';
import { EnvCPConfig } from '../src/types';

const makeConfig = (): EnvCPConfig => ({
  version: '1.0',
  storage: { path: '.envcp/store.json', encrypted: false },
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
    audit_log: false,
    blacklist_patterns: [],
  },
  sync: { enabled: false, target: '.env', exclude: [], format: 'dotenv' },
  session: { enabled: false, timeout_minutes: 30, max_extensions: 5, path: '.envcp/.session' },
  encryption: { enabled: false },
  security: { mode: 'recoverable', recovery_file: '.envcp/.recovery' },
  password: { min_length: 1, require_complexity: false, allow_numeric_only: true, allow_single_char: true },
});

// Expose BaseAdapter internals for testing
class TestableAdapter extends BaseAdapter {
  protected registerTools(): void {
    this.registerDefaultTools();
  }
}

describe('EnvCPServer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-mcp-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('constructs without throwing', () => {
    expect(() => new EnvCPServer(makeConfig(), tmpDir)).not.toThrow();
  });

  it('exposes an adapter with the default tool definitions', () => {
    const server = new EnvCPServer(makeConfig(), tmpDir);
    const adapter = (server as unknown as { adapter: BaseAdapter }).adapter;
    const tools = adapter.getToolDefinitions();

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    const names = tools.map(t => t.name);
    expect(names).toContain('envcp_list');
    expect(names).toContain('envcp_get');
    expect(names).toContain('envcp_set');
    expect(names).toContain('envcp_delete');
  });

  it('each tool definition has name, description, and parameters', () => {
    const server = new EnvCPServer(makeConfig(), tmpDir);
    const adapter = (server as unknown as { adapter: BaseAdapter }).adapter;

    for (const tool of adapter.getToolDefinitions()) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.parameters).toBeDefined();
    }
  });
});

describe('MCP adapter tool execution', () => {
  let tmpDir: string;
  let adapter: TestableAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-mcp-exec-test-'));
    adapter = new TestableAdapter(makeConfig(), tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('callTool envcp_list returns empty list initially', async () => {
    const result = await adapter.callTool('envcp_list', {}) as { variables: string[]; count: number };
    expect(result.variables).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('callTool envcp_set creates a variable', async () => {
    const result = await adapter.callTool('envcp_set', {
      name: 'MCP_VAR',
      value: 'mcp_value',
    }) as { success: boolean; message: string };

    expect(result.success).toBe(true);
  });

  it('callTool envcp_get retrieves a created variable', async () => {
    await adapter.callTool('envcp_set', { name: 'GET_VAR', value: 'get_val' });

    const result = await adapter.callTool('envcp_get', {
      name: 'GET_VAR',
    }) as { name: string; value: string };

    expect(result.name).toBe('GET_VAR');
    expect(typeof result.value).toBe('string');
  });

  it('callTool envcp_delete removes a variable', async () => {
    await adapter.callTool('envcp_set', { name: 'DEL_VAR', value: 'del_val' });
    const result = await adapter.callTool('envcp_delete', { name: 'DEL_VAR' }) as { success: boolean };
    expect(result.success).toBe(true);

    const list = await adapter.callTool('envcp_list', {}) as { variables: string[] };
    expect(list.variables).not.toContain('DEL_VAR');
  });

  it('callTool throws for unknown tool', async () => {
    await expect(adapter.callTool('no_such_tool', {})).rejects.toThrow('Unknown tool: no_such_tool');
  });

  it('callTool envcp_check_access returns access info', async () => {
    await adapter.callTool('envcp_set', { name: 'CHECK_VAR', value: 'v' });

    const result = await adapter.callTool('envcp_check_access', { name: 'CHECK_VAR' }) as {
      name: string;
      accessible: boolean;
    };

    expect(result.accessible).toBe(true);
    expect(result.name).toBe('CHECK_VAR');
  });

  it('callTool envcp_list filters by tags', async () => {
    await adapter.callTool('envcp_set', { name: 'TAGGED_VAR', value: 'v', tags: ['prod'] });
    await adapter.callTool('envcp_set', { name: 'OTHER_VAR', value: 'v', tags: ['dev'] });

    const result = await adapter.callTool('envcp_list', { tags: ['prod'] }) as { variables: string[] };
    expect(result.variables).toContain('TAGGED_VAR');
    expect(result.variables).not.toContain('OTHER_VAR');
  });

  it('callTool envcp_set rejects invalid variable names', async () => {
    await expect(
      adapter.callTool('envcp_set', { name: '123INVALID', value: 'v' }),
    ).rejects.toThrow(/Invalid variable name/);
  });

  it('callTool envcp_list throws when AI read is disabled', async () => {
    const restrictedAdapter = new TestableAdapter(
      {
        ...makeConfig(),
        access: { ...makeConfig().access, allow_ai_read: false },
      },
      tmpDir,
    );
    await restrictedAdapter.init();

    await expect(restrictedAdapter.callTool('envcp_list', {})).rejects.toThrow(
      'AI read access is disabled',
    );
  });
});
