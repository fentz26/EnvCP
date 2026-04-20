import { BaseAdapter } from './base.js';
import { EnvCPConfig, GeminiFunctionDeclaration, GeminiFunctionCall, GeminiFunctionResponse, RateLimitConfig } from '../types.js';
import { setCorsHeaders, sendJson, parseBody, validateApiKey, RateLimiter, rateLimitMiddleware } from '../utils/http.js';
import { VERSION } from '../version.js';
import * as http from 'http';

export class GeminiAdapter extends BaseAdapter {
  private server: http.Server | null = null;
  private rateLimiter = new RateLimiter(60, 60000);

  constructor(config: EnvCPConfig, projectPath: string, password?: string, vaultPath?: string, sessionPath?: string) {
    super(config, projectPath, password, vaultPath, sessionPath);
  }

  protected registerTools(): void {
    this.registerDefaultTools();
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          name: call.name,
          response: { error: message },
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
        const providedKey = (req.headers['x-goog-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '')) as string | undefined;
        if (!validateApiKey(providedKey, apiKey)) {
          await this.logs.log({ timestamp: new Date().toISOString(), operation: 'auth_failure', variable: '', source: 'api', success: false, message: `Invalid API key from ${req.socket.remoteAddress || 'unknown'}` });
          sendJson(res, 401, { error: { code: 401, message: 'Invalid API key', status: 'UNAUTHENTICATED' } });
          return;
        }
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      const clientIdHeader = req.headers['x-envcp-client-id'];
      /* c8 ignore next -- HTTP/1.1 joins duplicate headers; array branch unreachable in practice */
      const clientId = (Array.isArray(clientIdHeader) ? clientIdHeader[0] : clientIdHeader) || 'gemini';

      try {
        // Gemini-compatible endpoints

        // GET /v1/models - List models
        if (pathname === '/v1/models' && req.method === 'GET') {
          sendJson(res, 200, {
            models: [{
              name: `models/envcp-${VERSION}`,
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

          const result = await this.callTool(name, args || {}, clientId);
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
            version: VERSION,
            mode: 'gemini',
            endpoints: ['/v1/models', '/v1/tools', '/v1/functions/call', '/v1/function_calls', '/v1/models/envcp:generateContent'],
          });
          return;
        }

        // 404
        sendJson(res, 404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });

      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { error: { code: 500, message, status: 'INTERNAL' } });
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
    this.rateLimiter?.destroy();
  }
}
