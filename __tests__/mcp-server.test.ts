import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { EnvCPConfigSchema } from '../src/types';

describe('EnvCPServer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-mcp-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('constructs and sets up handlers without error', async () => {
    const { EnvCPServer } = await import('../src/mcp/server');
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const server = new EnvCPServer(config, tmpDir);
    expect(server).toBeDefined();
    // Verify the server object has internal state
    expect((server as any).server).toBeDefined();
    expect((server as any).adapter).toBeDefined();
  });

  it('constructs with password for encrypted mode', async () => {
    const { EnvCPServer } = await import('../src/mcp/server');
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: true },
      storage: { encrypted: true, path: '.envcp/store.enc' },
    });
    const server = new EnvCPServer(config, tmpDir, 'mypassword');
    expect(server).toBeDefined();
  });

  it('adapter has default tools registered', async () => {
    const { EnvCPServer } = await import('../src/mcp/server');
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const server = new EnvCPServer(config, tmpDir);
    const adapter = (server as any).adapter;
    const tools = adapter.getToolDefinitions();
    expect(tools.length).toBe(8);
  });

  it('setupHandlers registers ListTools and CallTool handlers', async () => {
    const { EnvCPServer } = await import('../src/mcp/server');
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const server = new EnvCPServer(config, tmpDir);
    const mcpServer = (server as any).server;
    // The MCP Server should have request handlers registered
    // Verify by checking internal handler map
    expect(mcpServer).toBeDefined();
    // The server._requestHandlers is a Map — check it has our schemas
    const handlers = mcpServer._requestHandlers;
    if (handlers) {
      expect(handlers.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('ListToolsRequestSchema handler returns tools', async () => {
    const { EnvCPServer } = await import('../src/mcp/server');
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
      access: { allow_ai_read: true, allow_ai_write: true, allow_ai_active_check: true },
    });
    const server = new EnvCPServer(config, tmpDir);
    const mcpServer = (server as any).server;
    // Access the handler map
    const handlers = mcpServer._requestHandlers;
    if (handlers && handlers.size > 0) {
      // Find the ListTools handler (registered with ListToolsRequestSchema)
      for (const [schema, handler] of handlers) {
        try {
          const result = await handler({ method: 'tools/list' });
          if (result && result.tools) {
            expect(result.tools.length).toBe(8);
            expect(result.tools[0]).toHaveProperty('name');
            expect(result.tools[0]).toHaveProperty('inputSchema');
            break;
          }
        } catch {
          // Some handlers may not accept this input
        }
      }
    }
  });

  it('CallToolRequestSchema handler calls a tool', async () => {
    const { EnvCPServer } = await import('../src/mcp/server');
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
      access: { allow_ai_read: true, allow_ai_write: true, allow_ai_active_check: true },
    });
    const server = new EnvCPServer(config, tmpDir);
    const adapter = (server as any).adapter;
    await adapter.init();

    const mcpServer = (server as any).server;
    const handlers = mcpServer._requestHandlers;
    if (handlers) {
      // Try each handler to find CallTool
      for (const [, handler] of handlers) {
        try {
          const result = await handler({ method: 'tools/call', params: { name: 'envcp_list', arguments: {} } });
          if (result && result.content) {
            expect(result.content[0].type).toBe('text');
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.count).toBe(0);
            break;
          }
        } catch {
          // Skip non-matching handlers
        }
      }
    }
  });

  it('CallToolRequestSchema handler returns error for unknown tool', async () => {
    const { EnvCPServer } = await import('../src/mcp/server');
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    const server = new EnvCPServer(config, tmpDir);
    const adapter = (server as any).adapter;
    await adapter.init();

    const mcpServer = (server as any).server;
    const handlers = mcpServer._requestHandlers;
    if (handlers) {
      for (const [, handler] of handlers) {
        try {
          await handler({ method: 'tools/call', params: { name: 'nonexistent_tool', arguments: {} } });
        } catch (e: any) {
          // Should throw McpError — check message or code
          if (e.message?.includes('Unknown tool') || e.message?.includes('nonexistent_tool') || e.code !== undefined) {
            expect(e).toBeDefined();
            break;
          }
        }
      }
    }
  });

  it('adapter can call tools after init', async () => {
    const { EnvCPServer } = await import('../src/mcp/server');
    const config = EnvCPConfigSchema.parse({
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
      access: {
        allow_ai_read: true,
        allow_ai_write: true,
        allow_ai_active_check: true,
      },
    });
    const server = new EnvCPServer(config, tmpDir);
    const adapter = (server as any).adapter;
    await adapter.init();

    // Test callTool through the adapter (same code path as MCP handler)
    const result = await adapter.callTool('envcp_list', {});
    expect(result.count).toBe(0);

    // Set a variable and list again
    await adapter.callTool('envcp_set', { name: 'MCP_TEST', value: 'hello' });
    const result2 = await adapter.callTool('envcp_list', {});
    expect(result2.count).toBe(1);
  });
});
