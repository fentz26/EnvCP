// NOSONAR typescript:S1874 -- McpServer (high-level API) requires Zod schemas
// per tool and hides getClientVersion(); the low-level `Server` is still
// supported and is required here for dynamic JSON-schema tool registration
// and per-client audit logging.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'; // NOSONAR
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from '../version.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { BaseAdapter } from '../adapters/base.js';
import { EnvCPConfig } from '../types.js';

class McpAdapter extends BaseAdapter {
  protected registerTools(): void {
    this.registerDefaultTools();
  }
}

export class EnvCPServer {
  private readonly server: Server; // NOSONAR typescript:S1874
  private readonly adapter: McpAdapter;

  constructor(config: EnvCPConfig, projectPath: string, password?: string, vaultPath?: string, sessionPath?: string) {
    this.adapter = new McpAdapter(config, projectPath, password, vaultPath, sessionPath);

    this.server = new Server( // NOSONAR typescript:S1874
      { name: 'envcp', version: VERSION },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.adapter.getToolDefinitions().map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const clientInfo = (this.server as unknown as { getClientVersion?: () => { name?: string } | undefined })
        .getClientVersion?.();
      /* c8 ignore next -- MCP SDK getClientVersion rarely returns a named client in tests */
      const clientId = clientInfo?.name || 'mcp';

      try {
        const result = await this.adapter.callTool(name, args || {}, clientId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, message);
      }
    });
  }

  async start(): Promise<void> {
    await this.adapter.init();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
