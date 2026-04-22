import { BaseAdapter } from './base.js';
import { OpenAIFunction, OpenAIToolCall, OpenAIMessage, RateLimitConfig } from '../types.js';
import { sendJson, parseBody } from '../utils/http.js';
import { VERSION } from '../version.js';
import { TOOLS_MESSAGE, buildChatCompletionBase } from './shared.js';
import * as http from 'node:http';

export class OpenAIAdapter extends BaseAdapter {
  private server: http.Server | null = null;

  private async handleFunctionCall(req: http.IncomingMessage, res: http.ServerResponse, clientId: string): Promise<void> {
    const body = await parseBody(req);
    const { name, arguments: args } = body as { name: string; arguments: Record<string, unknown> };
    if (!name) {
      sendJson(res, 400, { error: { message: 'Function name required', type: 'invalid_request_error' } });
      return;
    }

    const result = await this.callTool(name, args ?? {}, clientId);
    sendJson(res, 200, { object: 'function_result', name, result });
  }

  private async handleToolCalls(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await parseBody(req);
    const { tool_calls } = body as { tool_calls: OpenAIToolCall[] };
    if (!Array.isArray(tool_calls)) {
      sendJson(res, 400, { error: { message: 'tool_calls array required', type: 'invalid_request_error' } });
      return;
    }

    const results = await this.processToolCalls(tool_calls);
    sendJson(res, 200, { object: 'list', data: results });
  }

  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await parseBody(req);
    const messages = body.messages as OpenAIMessage[] | undefined;
    if (!Array.isArray(messages)) {
      sendJson(res, 400, { error: { message: 'messages array required', type: 'invalid_request_error' } });
      return;
    }

    const lastMessage = messages.at(-1);
    if (lastMessage?.tool_calls) {
      const results = await this.processToolCalls(lastMessage.tool_calls);
      sendJson(res, 200, this.createToolResultsCompletion(results));
      return;
    }

    sendJson(res, 200, this.createAvailableToolsCompletion());
  }

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

  createToolResultsCompletion(results: OpenAIMessage[]): Record<string, unknown> {
    return {
      ...buildChatCompletionBase({ role: 'assistant', content: null, tool_calls: null }, 'tool_calls'),
      tool_results: results,
    };
  }

  createAvailableToolsCompletion(): Record<string, unknown> {
    return {
      ...buildChatCompletionBase({ role: 'assistant', content: TOOLS_MESSAGE }, 'stop'),
      available_tools: this.getOpenAIFunctions().map(f => ({ type: 'function', function: f })),
    };
  }

  createFunctionsListResponse(): Record<string, unknown> {
    return { object: 'list', data: this.getOpenAIFunctions() };
  }

  createHealthResponse(): Record<string, unknown> {
    return {
      status: 'ok',
      version: VERSION,
      mode: 'openai',
      endpoints: ['/v1/models', '/v1/functions', '/v1/functions/call', '/v1/tool_calls', '/v1/chat/completions'],
    };
  }

  async startServer(port: number, host: string, apiKey?: string, rateLimitConfig?: RateLimitConfig): Promise<void> {
    this.server = await this.startBrandedHttpServer({
      port,
      host,
      apiKey,
      rateLimitConfig,
      defaultClientId: 'openai',
      authHeaderFn: (req) => req.headers['authorization']?.replace(/^Bearer\s+/i, ''),
      authFailureResponse: (message) => ({ error: { message, type: 'invalid_api_key' } }),
      internalErrorResponse: (message) => ({ error: { message, type: 'internal_error' } }),
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
          sendJson(res, 200, this.createFunctionsListResponse());
          return;
        }

        if (pathname === '/v1/functions/call' && req.method === 'POST') {
          await this.handleFunctionCall(req, res, clientId);
          return;
        }

        if (pathname === '/v1/tool_calls' && req.method === 'POST') {
          await this.handleToolCalls(req, res);
          return;
        }

        if (pathname === '/v1/chat/completions' && req.method === 'POST') {
          await this.handleChatCompletions(req, res);
          return;
        }

        if (pathname === '/v1/health' || pathname === '/') {
          sendJson(res, 200, this.createHealthResponse());
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
