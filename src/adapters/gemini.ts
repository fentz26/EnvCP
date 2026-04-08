import { BaseAdapter } from './base.js';
import { EnvCPConfig, GeminiFunctionDeclaration, GeminiFunctionCall, GeminiFunctionResponse, ToolDefinition } from '../types.js';
import { setCorsHeaders, sendJson, parseBody, validateApiKey } from '../utils/http.js';
import * as http from 'http';

export class GeminiAdapter extends BaseAdapter {
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
        handler: async (params) => this.setVariable(params as { name: string; value: string; tags?: string[]; description?: string }),
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

  // Convert tools to Gemini function declaration format
  getGeminiFunctionDeclarations(): GeminiFunctionDeclaration[] {
    return this.getToolDefinitions().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: (tool.parameters as Record<string, unknown>).properties as Record<string, unknown> || {},
        required: (tool.parameters as Record<string, unknown>).required as string[] | undefined,
      },
    }));
  }

  // Process Gemini function calls
  async processFunctionCalls(calls: GeminiFunctionCall[]): Promise<GeminiFunctionResponse[]> {
    const results: GeminiFunctionResponse[] = [];

    for (const call of calls) {
      try {
        const result = await this.callTool(call.name, call.args);
        results.push({
          name: call.name,
          response: { result },
        });
      } catch (error: any) {
        results.push({
          name: call.name,
          response: { error: error.message },
        });
      }
    }

    return results;
  }


  async startServer(port: number, host: string, apiKey?: string): Promise<void> {
    await this.init();

    this.server = http.createServer(async (req, res) => {
      setCorsHeaders(res, undefined, req.headers.origin);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // API key validation
      if (apiKey) {
        const providedKey = (req.headers['x-goog-api-key'] || req.headers['authorization']?.replace('Bearer ', '')) as string | undefined;
        if (!validateApiKey(providedKey, apiKey)) {
          sendJson(res, 401, { error: { code: 401, message: 'Invalid API key', status: 'UNAUTHENTICATED' } });
          return;
        }
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      try {
        // Gemini-compatible endpoints

        // GET /v1/models - List models
        if (pathname === '/v1/models' && req.method === 'GET') {
          sendJson(res, 200, {
            models: [{
              name: 'models/envcp-1.0',
              displayName: 'EnvCP Tool Server',
              description: 'Environment variable management tools',
              supportedGenerationMethods: ['generateContent'],
            }],
          });
          return;
        }

        // GET /v1/tools - List available tools/functions
        if (pathname === '/v1/tools' && req.method === 'GET') {
          sendJson(res, 200, {
            tools: [{
              functionDeclarations: this.getGeminiFunctionDeclarations(),
            }],
          });
          return;
        }

        // POST /v1/functions/call - Call a function directly
        if (pathname === '/v1/functions/call' && req.method === 'POST') {
          const body = await parseBody(req);
          const { name, args } = body as { name: string; args: Record<string, unknown> };

          if (!name) {
            sendJson(res, 400, { error: { code: 400, message: 'Function name required', status: 'INVALID_ARGUMENT' } });
            return;
          }

          const result = await this.callTool(name, args || {});
          sendJson(res, 200, {
            name,
            response: { result },
          });
          return;
        }

        // POST /v1/function_calls - Process function calls (batch)
        if (pathname === '/v1/function_calls' && req.method === 'POST') {
          const body = await parseBody(req);
          const { functionCalls } = body as { functionCalls: GeminiFunctionCall[] };

          if (!functionCalls || !Array.isArray(functionCalls)) {
            sendJson(res, 400, { error: { code: 400, message: 'functionCalls array required', status: 'INVALID_ARGUMENT' } });
            return;
          }

          const results = await this.processFunctionCalls(functionCalls);
          sendJson(res, 200, {
            functionResponses: results,
          });
          return;
        }

        // POST /v1/models/envcp:generateContent - Gemini-style content generation
        if ((pathname === '/v1/models/envcp:generateContent' || pathname === '/v1beta/models/envcp:generateContent') && req.method === 'POST') {
          const body = await parseBody(req);
          const contents = body.contents as Array<{ parts: Array<{ functionCall?: GeminiFunctionCall }> }> | undefined;

          // Look for function calls in the content
          const functionCalls: GeminiFunctionCall[] = [];
          if (contents) {
            for (const content of contents) {
              for (const part of content.parts || []) {
                if (part.functionCall) {
                  functionCalls.push(part.functionCall);
                }
              }
            }
          }

          if (functionCalls.length > 0) {
            const results = await this.processFunctionCalls(functionCalls);
            sendJson(res, 200, {
              candidates: [{
                content: {
                  parts: results.map(r => ({
                    functionResponse: r,
                  })),
                  role: 'model',
                },
                finishReason: 'STOP',
              }],
            });
            return;
          }

          // Return available tools if no function calls
          sendJson(res, 200, {
            candidates: [{
              content: {
                parts: [{
                  text: 'EnvCP tools available. Use function calling to interact with environment variables.',
                }],
                role: 'model',
              },
              finishReason: 'STOP',
            }],
            availableTools: [{
              functionDeclarations: this.getGeminiFunctionDeclarations(),
            }],
          });
          return;
        }

        // Health check
        if (pathname === '/v1/health' || pathname === '/') {
          sendJson(res, 200, {
            status: 'ok',
            version: '1.0.0',
            mode: 'gemini',
            endpoints: ['/v1/models', '/v1/tools', '/v1/functions/call', '/v1/function_calls', '/v1/models/envcp:generateContent'],
          });
          return;
        }

        // 404
        sendJson(res, 404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });

      } catch (error: any) {
        sendJson(res, 500, { error: { code: 500, message: error.message, status: 'INTERNAL' } });
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
