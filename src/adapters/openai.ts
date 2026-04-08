import { BaseAdapter } from './base.js';
import { EnvCPConfig, OpenAIFunction, OpenAIToolCall, OpenAIMessage, ToolDefinition } from '../types.js';
import * as http from 'http';
import * as url from 'url';

export class OpenAIAdapter extends BaseAdapter {
  private server: http.Server | null = null;

  constructor(config: EnvCPConfig, projectPath: string, password?: string) {
    super(config, projectPath, password);
  }

  protected registerTools(): void {
    const tools: ToolDefinition[] = [
      {
        name: 'envcp_list',
        description: 'List all available environment variable names. Values are never shown.',
        parameters: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by tags',
            },
          },
        },
        handler: async (params) => this.listVariables(params as { tags?: string[] }),
      },
      {
        name: 'envcp_get',
        description: 'Get an environment variable. Returns masked value by default.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
            show_value: { type: 'boolean', description: 'Show actual value (requires user confirmation)' },
          },
          required: ['name'],
        },
        handler: async (params) => this.getVariable(params as { name: string; show_value?: boolean }),
      },
      {
        name: 'envcp_set',
        description: 'Create or update an environment variable.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
            value: { type: 'string', description: 'Variable value' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
            description: { type: 'string', description: 'Description' },
          },
          required: ['name', 'value'],
        },
        handler: async (params) => this.setVariable(params as any),
      },
      {
        name: 'envcp_delete',
        description: 'Delete an environment variable.',
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
        description: 'Sync variables to .env file.',
        parameters: {
          type: 'object',
          properties: {},
        },
        handler: async () => this.syncToEnv(),
      },
      {
        name: 'envcp_run',
        description: 'Execute a command with environment variables injected.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            variables: { type: 'array', items: { type: 'string' }, description: 'Variables to inject' },
          },
          required: ['command', 'variables'],
        },
        handler: async (params) => this.runCommand(params as { command: string; variables: string[] }),
      },
      {
        name: 'envcp_check_access',
        description: 'Check if a variable exists and can be accessed.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
          },
          required: ['name'],
        },
        handler: async (params) => this.checkAccess(params as { name: string }),
      },
    ];

    tools.forEach(tool => this.tools.set(tool.name, tool));
  }

  // Convert tools to OpenAI function format
  getOpenAIFunctions(): OpenAIFunction[] {
    return this.getToolDefinitions().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: (tool.parameters as any).properties || {},
        required: (tool.parameters as any).required,
      },
    }));
  }

  // Process OpenAI tool calls
  async processToolCalls(toolCalls: OpenAIToolCall[]): Promise<OpenAIMessage[]> {
    const results: OpenAIMessage[] = [];

    for (const call of toolCalls) {
      try {
        const args = JSON.parse(call.function.arguments);
        const result = await this.callTool(call.function.name, args);
        results.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (error: any) {
        results.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: error.message }),
        });
      }
    }

    return results;
  }

  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  async startServer(port: number, host: string, apiKey?: string): Promise<void> {
    await this.init();

    this.server = http.createServer(async (req, res) => {
      this.setCorsHeaders(res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // API key validation
      if (apiKey) {
        const authHeader = req.headers['authorization'];
        const providedKey = authHeader?.replace('Bearer ', '');
        if (providedKey !== apiKey) {
          this.sendJson(res, 401, { error: { message: 'Invalid API key', type: 'invalid_api_key' } });
          return;
        }
      }

      const parsedUrl = url.parse(req.url || '/', true);
      const pathname = parsedUrl.pathname || '/';

      try {
        // OpenAI-compatible endpoints

        // GET /v1/models - List models (for compatibility)
        if (pathname === '/v1/models' && req.method === 'GET') {
          this.sendJson(res, 200, {
            object: 'list',
            data: [{
              id: 'envcp-1.0',
              object: 'model',
              created: Date.now(),
              owned_by: 'envcp',
            }],
          });
          return;
        }

        // GET /v1/functions - List available functions
        if (pathname === '/v1/functions' && req.method === 'GET') {
          this.sendJson(res, 200, {
            object: 'list',
            data: this.getOpenAIFunctions(),
          });
          return;
        }

        // POST /v1/functions/call - Call a function directly
        if (pathname === '/v1/functions/call' && req.method === 'POST') {
          const body = await this.parseBody(req);
          const { name, arguments: args } = body as { name: string; arguments: Record<string, unknown> };
          
          if (!name) {
            this.sendJson(res, 400, { error: { message: 'Function name required', type: 'invalid_request_error' } });
            return;
          }

          const result = await this.callTool(name, args || {});
          this.sendJson(res, 200, {
            object: 'function_result',
            name,
            result,
          });
          return;
        }

        // POST /v1/tool_calls - Process tool calls (batch)
        if (pathname === '/v1/tool_calls' && req.method === 'POST') {
          const body = await this.parseBody(req);
          const { tool_calls } = body as { tool_calls: OpenAIToolCall[] };

          if (!tool_calls || !Array.isArray(tool_calls)) {
            this.sendJson(res, 400, { error: { message: 'tool_calls array required', type: 'invalid_request_error' } });
            return;
          }

          const results = await this.processToolCalls(tool_calls);
          this.sendJson(res, 200, {
            object: 'list',
            data: results,
          });
          return;
        }

        // POST /v1/chat/completions - For integration with proxies
        // This allows tools to be called through a chat completion-like interface
        if (pathname === '/v1/chat/completions' && req.method === 'POST') {
          const body = await this.parseBody(req);
          const messages = body.messages as OpenAIMessage[] | undefined;

          if (!messages || !Array.isArray(messages)) {
            this.sendJson(res, 400, { error: { message: 'messages array required', type: 'invalid_request_error' } });
            return;
          }

          // Check if last message has tool_calls to process
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.tool_calls) {
            const results = await this.processToolCalls(lastMessage.tool_calls);
            this.sendJson(res, 200, {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'envcp-1.0',
              choices: [{
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: null,
                },
                finish_reason: 'tool_calls',
              }],
              tool_results: results,
            });
            return;
          }

          // Return available tools if no tool_calls
          this.sendJson(res, 200, {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'envcp-1.0',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'EnvCP tools available. Use function calling to interact with environment variables.',
              },
              finish_reason: 'stop',
            }],
            available_tools: this.getOpenAIFunctions().map(f => ({
              type: 'function',
              function: f,
            })),
          });
          return;
        }

        // Health check
        if (pathname === '/v1/health' || pathname === '/') {
          this.sendJson(res, 200, {
            status: 'ok',
            version: '1.0.0',
            mode: 'openai',
            endpoints: ['/v1/models', '/v1/functions', '/v1/functions/call', '/v1/tool_calls', '/v1/chat/completions'],
          });
          return;
        }

        // 404
        this.sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });

      } catch (error: any) {
        this.sendJson(res, 500, { error: { message: error.message, type: 'internal_error' } });
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(port, host, () => {
        resolve();
      });
    });
  }

  stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
