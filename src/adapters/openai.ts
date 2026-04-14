import { BaseAdapter } from './base.js';
import { EnvCPConfig, OpenAIFunction, OpenAIToolCall, OpenAIMessage, RateLimitConfig } from '../types.js';
import { setCorsHeaders, sendJson, parseBody, validateApiKey, RateLimiter, rateLimitMiddleware } from '../utils/http.js';
import * as http from 'http';

export class OpenAIAdapter extends BaseAdapter {
  private server: http.Server | null = null;
  private rateLimiter = new RateLimiter(60, 60000);

  constructor(config: EnvCPConfig, projectPath: string, password?: string, vaultPath?: string) {
    super(config, projectPath, password, vaultPath);
  }

  protected registerTools(): void {
    this.registerDefaultTools();
  }

  // Convert tools to OpenAI function format
  getOpenAIFunctions(): OpenAIFunction[] {
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: message }),
        });
      }
    }

    return results;
  }


async startServer(port: number, host: string, apiKey?: string, rateLimitConfig?: RateLimitConfig): Promise<void> {
  await this.init();

  const rateLimitEnabled = rateLimitConfig?.enabled !== false;
  if (rateLimitEnabled) {
    this.rateLimiter?.destroy();
    this.rateLimiter = new RateLimiter(rateLimitConfig?.requests_per_minute ?? 60, 60000);
  }
  const whitelist = rateLimitConfig?.whitelist ?? [];

    this.server = http.createServer(async (req, res) => {
      setCorsHeaders(res, undefined, req.headers.origin);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (rateLimitEnabled && !rateLimitMiddleware(this.rateLimiter, req, res, whitelist)) {
        return;
      }

      // API key validation
      if (apiKey) {
        const providedKey = req.headers['authorization']?.replace('Bearer ', '');
        if (!validateApiKey(providedKey, apiKey)) {
          await this.logs.log({ timestamp: new Date().toISOString(), operation: 'auth_failure', variable: '', source: 'api', success: false, message: `Invalid API key from ${req.socket.remoteAddress || 'unknown'}` });
          sendJson(res, 401, { error: { message: 'Invalid API key', type: 'invalid_api_key' } });
          return;
        }
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      try {
        // OpenAI-compatible endpoints

        // GET /v1/models - List models (for compatibility)
        if (pathname === '/v1/models' && req.method === 'GET') {
          sendJson(res, 200, {
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
          sendJson(res, 200, {
            object: 'list',
            data: this.getOpenAIFunctions(),
          });
          return;
        }

        // POST /v1/functions/call - Call a function directly
        if (pathname === '/v1/functions/call' && req.method === 'POST') {
          const body = await parseBody(req);
          const { name, arguments: args } = body as { name: string; arguments: Record<string, unknown> };
          
          if (!name) {
            sendJson(res, 400, { error: { message: 'Function name required', type: 'invalid_request_error' } });
            return;
          }

          const result = await this.callTool(name, args || {});
          sendJson(res, 200, {
            object: 'function_result',
            name,
            result,
          });
          return;
        }

        // POST /v1/tool_calls - Process tool calls (batch)
        if (pathname === '/v1/tool_calls' && req.method === 'POST') {
          const body = await parseBody(req);
          const { tool_calls } = body as { tool_calls: OpenAIToolCall[] };

          if (!tool_calls || !Array.isArray(tool_calls)) {
            sendJson(res, 400, { error: { message: 'tool_calls array required', type: 'invalid_request_error' } });
            return;
          }

          const results = await this.processToolCalls(tool_calls);
          sendJson(res, 200, {
            object: 'list',
            data: results,
          });
          return;
        }

        // POST /v1/chat/completions - For integration with proxies
        // This allows tools to be called through a chat completion-like interface
        if (pathname === '/v1/chat/completions' && req.method === 'POST') {
          const body = await parseBody(req);
          const messages = body.messages as OpenAIMessage[] | undefined;

          if (!messages || !Array.isArray(messages)) {
            sendJson(res, 400, { error: { message: 'messages array required', type: 'invalid_request_error' } });
            return;
          }

          // Check if last message has tool_calls to process
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.tool_calls) {
            const results = await this.processToolCalls(lastMessage.tool_calls);
            sendJson(res, 200, {
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
          sendJson(res, 200, {
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
          sendJson(res, 200, {
            status: 'ok',
            version: '1.0.0',
            mode: 'openai',
            endpoints: ['/v1/models', '/v1/functions', '/v1/functions/call', '/v1/tool_calls', '/v1/chat/completions'],
          });
          return;
        }

        // 404
        sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });

      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { error: { message, type: 'internal_error' } });
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
