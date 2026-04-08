import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { BaseAdapter } from '../adapters/base.js';
import { EnvCPConfig, ToolDefinition } from '../types.js';

class McpAdapter extends BaseAdapter {
  protected registerTools(): void {
    const tools: ToolDefinition[] = [
      {
        name: 'envcp_list',
        description: 'List all available environment variable names. Values are never shown to AI. Only available if allow_ai_active_check is enabled.',
        parameters: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
          },
        },
        handler: async (params) => this.listVariables(params as { tags?: string[] }),
      },
      {
        name: 'envcp_get',
        description: 'Get an environment variable. Returns masked value by default. Use show_value=true to see the actual value (requires user confirmation).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
            show_value: { type: 'boolean', description: 'Show actual value (default: false, returns masked value)' },
          },
          required: ['name'],
        },
        handler: async (params) => this.getVariable(params as { name: string; show_value?: boolean }),
      },
      {
        name: 'envcp_set',
        description: 'Create or update an environment variable. Only available if allow_ai_write is enabled.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
            value: { type: 'string', description: 'Variable value' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organization' },
            description: { type: 'string', description: 'Variable description' },
          },
          required: ['name', 'value'],
        },
        handler: async (params) => this.setVariable(params as { name: string; value: string; tags?: string[]; description?: string }),
      },
      {
        name: 'envcp_delete',
        description: 'Delete an environment variable. Only available if allow_ai_delete is enabled.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
          },
          required: ['name'],
        },
        handler: async (params) => this.deleteVariable(params as { name: string }),
      },
      {
        name: 'envcp_sync',
        description: 'Sync variables to .env file. Only available if sync is enabled.',
        parameters: { type: 'object', properties: {} },
        handler: async () => this.syncToEnv(),
      },
      {
        name: 'envcp_run',
        description: 'Execute a command with environment variables injected. Variables are loaded but not shown.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            variables: { type: 'array', items: { type: 'string' }, description: 'Variable names to inject' },
          },
          required: ['command', 'variables'],
        },
        handler: async (params) => this.runCommand(params as { command: string; variables: string[] }),
      },
      {
        name: 'envcp_add_to_env',
        description: 'Write a stored variable to a .env file. The value is written to disk but not returned in the response.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name to add' },
            env_file: { type: 'string', description: 'Path to .env file (default: .env)' },
          },
          required: ['name'],
        },
        handler: async (params) => this.addToEnv(params as { name: string; env_file?: string }),
      },
      {
        name: 'envcp_check_access',
        description: 'Check if a variable exists and can be accessed. Returns yes/no, not the value.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name to check' },
          },
          required: ['name'],
        },
        handler: async (params) => this.checkAccess(params as { name: string }),
      },
    ];

    tools.forEach(tool => this.tools.set(tool.name, tool));
  }
}

export class EnvCPServer {
  private server: Server;
  private adapter: McpAdapter;

  constructor(config: EnvCPConfig, projectPath: string, password?: string) {
    this.adapter = new McpAdapter(config, projectPath, password);

    this.server = new Server(
      { name: 'envcp', version: '1.0.0' },
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
