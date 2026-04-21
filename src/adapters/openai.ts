import { BaseAdapter } from './base.js';
import { OpenAIFunction, OpenAIToolCall, OpenAIMessage, RateLimitConfig } from '../types.js';
import { sendJson, parseBody } from '../utils/http.js';
import { VERSION } from '../version.js';
import * as http from 'node:http';

export class OpenAIAdapter extends BaseAdapter {
  private server: http.Server | null = null;

  getOpenAIFunctions(): OpenAIFunction[] {
    return this.getStructuredToolDefinitions();
  }

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

    this.server = await this.createHttpServer({
      port,
      host,
      apiKey,
      rateLimitConfig,
      defaultClientId: 'openai',
      authHeaderFn: (req) => req.headers['authorization']?.replace(/^Bearer\s+/i, ''),
      authFailureResponse: (message) => ({ error: { message, type: 'invalid_api_key' } }),
      internalErrorResponse: (message) => ({ error: { message, type: 'internal_error' } }),
      healthEndpoints: ['/v1/health', '/'],
      mode: 'openai',
      onRequest: async (req, res, pathname, clientId) => {
        if (pathname === '/v1/models' && req.method === 'GET') {
          sendJson(res, 200, {
            object: 'list',
            data: [{ id: `envcp-${VERSION}`, object: 'model', created: Date.now(), owned_by: 'envcp' }],
          });
          return;
        }

        if (pathname === '/v1/functions' && req.method === 'GET') {
          sendJson(res, 200, { object: 'list', data: this.getOpenAIFunctions() });
          return;
        }

        if (pathname === '/v1/functions/call' && req.method === 'POST') {
          const body = await parseBody(req);
          const { name, arguments: args } = body as { name: string; arguments: Record<string, unknown> };
          if (!name) {
            sendJson(res, 400, { error: { message: 'Function name required', type: 'invalid_request_error' } });
            return;
          }
          const result = await this.callTool(name, args || {}, clientId);
          sendJson(res, 200, { object: 'function_result', name, result });
          return;
        }

        if (pathname === '/v1/tool_calls' && req.method === 'POST') {
          const body = await parseBody(req);
          const { tool_calls } = body as { tool_calls: OpenAIToolCall[] };
          if (!tool_calls || !Array.isArray(tool_calls)) {
            sendJson(res, 400, { error: { message: 'tool_calls array required', type: 'invalid_request_error' } });
            return;
          }
          const results = await this.processToolCalls(tool_calls);
          sendJson(res, 200, { object: 'list', data: results });
          return;
        }

        if (pathname === '/v1/chat/completions' && req.method === 'POST') {
          const body = await parseBody(req);
          const messages = body.messages as OpenAIMessage[] | undefined;
          if (!messages || !Array.isArray(messages)) {
            sendJson(res, 400, { error: { message: 'messages array required', type: 'invalid_request_error' } });
            return;
          }

          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.tool_calls) {
            const results = await this.processToolCalls(lastMessage.tool_calls);
            sendJson(res, 200, {
              id: `chatcmpl-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: `envcp-${VERSION}`,
              choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: null }, finish_reason: 'tool_calls' }],
              tool_results: results,
            });
            return;
          }

          sendJson(res, 200, {
            id: `chatcmpl-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: `envcp-${VERSION}`,
            choices: [{ index: 0, message: { role: 'assistant', content: 'EnvCP tools available. Use function calling to interact with environment variables.' }, finish_reason: 'stop' }],
            available_tools: this.getOpenAIFunctions().map(f => ({ type: 'function', function: f })),
          });
          return;
        }

        if (pathname === '/v1/health' || pathname === '/') {
          sendJson(res, 200, { status: 'ok', version: VERSION, mode: 'openai', endpoints: ['/v1/models', '/v1/functions', '/v1/functions/call', '/v1/tool_calls', '/v1/chat/completions'] });
          return;
        }

        sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });
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
