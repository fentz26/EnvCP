import { BaseAdapter } from './base.js';
import { GeminiFunctionDeclaration, GeminiFunctionCall, GeminiFunctionResponse, RateLimitConfig } from '../types.js';
import { sendJson, parseBody } from '../utils/http.js';
import { VERSION } from '../version.js';
import * as http from 'node:http';

export class GeminiAdapter extends BaseAdapter {
  private server: http.Server | null = null;
  private static readonly TOOLS_MESSAGE = 'EnvCP tools available. Use function calling to interact with environment variables.';

  getGeminiFunctionDeclarations(): GeminiFunctionDeclaration[] {
    return this.getStructuredToolDefinitions();
  }

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

  createGenerateContentResponse(results: GeminiFunctionResponse[]): Record<string, unknown> {
    return {
      candidates: [{ content: { parts: results.map(r => ({ functionResponse: r })), role: 'model' }, finishReason: 'STOP' }],
    };
  }

  createAvailableToolsResponse(): Record<string, unknown> {
    return {
      candidates: [{ content: { parts: [{ text: GeminiAdapter.TOOLS_MESSAGE }], role: 'model' }, finishReason: 'STOP' }],
      availableTools: [{ functionDeclarations: this.getGeminiFunctionDeclarations() }],
    };
  }

  createToolsListResponse(): Record<string, unknown> {
    return { tools: [{ functionDeclarations: this.getGeminiFunctionDeclarations() }] };
  }

  createHealthResponse(): Record<string, unknown> {
    return {
      status: 'ok',
      version: VERSION,
      mode: 'gemini',
      endpoints: ['/v1/models', '/v1/tools', '/v1/functions/call', '/v1/function_calls', '/v1/models/envcp:generateContent'],
    };
  }

  async startServer(port: number, host: string, apiKey?: string, rateLimitConfig?: RateLimitConfig): Promise<void> {
    await this.init();

    this.server = await this.createHttpServer({
      port,
      host,
      apiKey,
      rateLimitConfig,
      defaultClientId: 'gemini',
      authHeaderFn: (req) => (req.headers['x-goog-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '')) as string | undefined,
      healthEndpoints: ['/v1/health', '/'],
      mode: 'gemini',
      onRequest: async (req, res, pathname, clientId) => {
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

        if (pathname === '/v1/tools' && req.method === 'GET') {
          sendJson(res, 200, this.createToolsListResponse());
          return;
        }

        if (pathname === '/v1/functions/call' && req.method === 'POST') {
          const body = await parseBody(req);
          const { name, args } = body as { name: string; args: Record<string, unknown> };
          if (!name) {
            sendJson(res, 400, { error: { code: 400, message: 'Function name required', status: 'INVALID_ARGUMENT' } });
            return;
          }
          const result = await this.callTool(name, args || {}, clientId);
          sendJson(res, 200, { name, response: { result } });
          return;
        }

        if (pathname === '/v1/function_calls' && req.method === 'POST') {
          const body = await parseBody(req);
          const { functionCalls } = body as { functionCalls: GeminiFunctionCall[] };
          if (!functionCalls || !Array.isArray(functionCalls)) {
            sendJson(res, 400, { error: { code: 400, message: 'functionCalls array required', status: 'INVALID_ARGUMENT' } });
            return;
          }
          const results = await this.processFunctionCalls(functionCalls);
          sendJson(res, 200, { functionResponses: results });
          return;
        }

        if ((pathname === '/v1/models/envcp:generateContent' || pathname === '/v1beta/models/envcp:generateContent') && req.method === 'POST') {
          const body = await parseBody(req);
          const contents = body.contents as Array<{ parts: Array<{ functionCall?: GeminiFunctionCall }> }> | undefined;
          const functionCalls: GeminiFunctionCall[] = [];
          if (contents) {
            for (const content of contents) {
              for (const part of content.parts || []) {
                if (part.functionCall) functionCalls.push(part.functionCall);
              }
            }
          }

          if (functionCalls.length > 0) {
            const results = await this.processFunctionCalls(functionCalls);
            sendJson(res, 200, this.createGenerateContentResponse(results));
            return;
          }

          sendJson(res, 200, this.createAvailableToolsResponse());
          return;
        }

        if (pathname === '/v1/health' || pathname === '/') {
          sendJson(res, 200, this.createHealthResponse());
          return;
        }

        sendJson(res, 404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
      },
    });
  }

  stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
