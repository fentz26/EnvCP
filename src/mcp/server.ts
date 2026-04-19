import { Server } from '@modelcontextprotocol/sdk/server/index.js';
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
  private server: Server;
  private adapter: McpAdapter;

  constructor(config: EnvCPConfig, projectPath: string, password?: string, vaultPath?: string, sessionPath?: string) {
    this.adapter = new McpAdapter(config, projectPath, password, vaultPath, sessionPath);

    this.server = new Server(
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

      try {
        const result = await this.adapter.callTool(name, (args || {}) as Record<string, unknown>);
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
