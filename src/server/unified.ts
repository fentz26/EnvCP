import { EnvCPConfig, ServerMode, ServerConfig, ClientType } from '../types.js';
import { RESTAdapter } from '../adapters/rest.js';
import { OpenAIAdapter } from '../adapters/openai.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { EnvCPServer } from '../mcp/server.js';
import { setCorsHeaders, sendJson, parseBody, validateApiKey, RateLimiter, rateLimitMiddleware } from '../utils/http.js';
import * as http from 'http';

export class UnifiedServer {
  private config: EnvCPConfig;
  private serverConfig: ServerConfig;
  private projectPath: string;
  private password?: string;

  private restAdapter: RESTAdapter | null = null;
  private openaiAdapter: OpenAIAdapter | null = null;
  private geminiAdapter: GeminiAdapter | null = null;
  private mcpServer: EnvCPServer | null = null;
  private httpServer: http.Server | null = null;
  private rateLimiter: RateLimiter = new RateLimiter(60, 60000);

  constructor(config: EnvCPConfig, serverConfig: ServerConfig, projectPath: string, password?: string) {
    this.config = config;
    this.serverConfig = serverConfig;
    this.projectPath = projectPath;
    this.password = password;
  }

  // Detect client type from request headers
  detectClientType(req: http.IncomingMessage): ClientType {
    const userAgent = req.headers['user-agent']?.toLowerCase() || '';
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;

    // Check for OpenAI-style requests
    if (pathname.startsWith('/v1/chat') ||
        pathname.startsWith('/v1/functions') ||
        pathname.startsWith('/v1/tool_calls') ||
        req.headers['openai-organization'] ||
        userAgent.includes('openai')) {
      return 'openai';
    }

    // Check for Gemini-style requests
    if (pathname.includes(':generateContent') ||
        pathname.startsWith('/v1beta') ||
        pathname.startsWith('/v1/function_calls') ||
        req.headers['x-goog-api-key'] ||
        userAgent.includes('google') ||
        userAgent.includes('gemini')) {
      return 'gemini';
    }

    // Check for MCP (typically stdio, but could be HTTP)
    if (req.headers['x-mcp-version'] ||
        userAgent.includes('mcp') ||
        userAgent.includes('claude')) {
      return 'mcp';
    }

    // Default to REST for standard HTTP requests
    if (pathname.startsWith('/api')) {
      return 'rest';
    }

    return 'unknown';
  }


  async start(): Promise<void> {
    const { mode, port, host, api_key } = this.serverConfig;

    // MCP mode uses stdio, not HTTP
    if (mode === 'mcp') {
      this.mcpServer = new EnvCPServer(this.config, this.projectPath, this.password);
      await this.mcpServer.start();
      return;
    }

    // Initialize adapters based on mode
    if (mode === 'rest' || mode === 'all' || mode === 'auto') {
      this.restAdapter = new RESTAdapter(this.config, this.projectPath, this.password);
      await this.restAdapter.init();
    }

    if (mode === 'openai' || mode === 'all' || mode === 'auto') {
      this.openaiAdapter = new OpenAIAdapter(this.config, this.projectPath, this.password);
      await this.openaiAdapter.init();
    }

    if (mode === 'gemini' || mode === 'all' || mode === 'auto') {
      this.geminiAdapter = new GeminiAdapter(this.config, this.projectPath, this.password);
      await this.geminiAdapter.init();
    }

    // Single mode - start specific adapter server
    const rl = this.serverConfig.rate_limit;
    const rateLimitEnabled = rl?.enabled !== false;
    if (rateLimitEnabled) {
      this.rateLimiter = new RateLimiter(rl?.requests_per_minute ?? 60, 60000);
    }
    const whitelist = rl?.whitelist ?? [];

    if (mode === 'rest') {
      await this.restAdapter!.startServer(port, host, api_key, rl);
      return;
    }

    if (mode === 'openai') {
      await this.openaiAdapter!.startServer(port, host, api_key, rl);
      return;
    }

    if (mode === 'gemini') {
      await this.geminiAdapter!.startServer(port, host, api_key, rl);
      return;
    }

    // Auto or All mode - unified server that routes based on detection
    this.httpServer = http.createServer(async (req, res) => {
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
      if (api_key) {
        const providedKey = (req.headers['x-api-key'] ||
                           req.headers['x-goog-api-key'] ||
                           req.headers['authorization']?.replace('Bearer ', '')) as string | undefined;
        if (!validateApiKey(providedKey, api_key)) {
          sendJson(res, 401, { error: 'Invalid API key' });
          return;
        }
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // Root endpoint - show server info and detected mode
      if (pathname === '/' && req.method === 'GET') {
        const detectedType = this.serverConfig.auto_detect ? this.detectClientType(req) : 'unknown';
        sendJson(res, 200, {
          name: 'EnvCP Unified Server',
          version: '1.0.0',
          mode: mode,
          detected_client: detectedType,
          auto_detect: this.serverConfig.auto_detect,
          available_modes: ['rest', 'openai', 'gemini', 'mcp'],
          endpoints: {
            rest: '/api/*',
            openai: '/v1/chat/completions, /v1/functions/*, /v1/tool_calls',
            gemini: '/v1/models/envcp:generateContent, /v1/function_calls',
          },
        });
        return;
      }

      // Detect client type
      let clientType: ClientType = 'unknown';
      if (this.serverConfig.auto_detect) {
        clientType = this.detectClientType(req);
      }

      // Force mode query param
      const forceMode = parsedUrl.searchParams.get('mode') || undefined;
      if (forceMode && ['rest', 'openai', 'gemini'].includes(forceMode)) {
        clientType = forceMode as ClientType;
      }

      try {
        // Route to appropriate adapter
        // REST API routes
        if ((clientType === 'rest' || clientType === 'unknown') && pathname.startsWith('/api')) {
          await this.handleRESTRequest(req, res);
          return;
        }

        // OpenAI routes
        if (clientType === 'openai' || pathname.startsWith('/v1/chat') || pathname.startsWith('/v1/functions') || pathname === '/v1/tool_calls' || pathname === '/v1/models') {
          await this.handleOpenAIRequest(req, res);
          return;
        }

        // Gemini routes
        if (clientType === 'gemini' || pathname.includes(':generateContent') || pathname === '/v1/function_calls' || pathname === '/v1/tools') {
          await this.handleGeminiRequest(req, res);
          return;
        }

        // Default to REST for unknown paths
        if (pathname.startsWith('/api')) {
          await this.handleRESTRequest(req, res);
          return;
        }

        // 404 with helpful info
        sendJson(res, 404, {
          error: 'Not found',
          hint: 'Use /api/* for REST, /v1/* for OpenAI, or include :generateContent for Gemini',
          available_endpoints: {
            rest: '/api/variables, /api/tools',
            openai: '/v1/functions, /v1/chat/completions',
            gemini: '/v1/models/envcp:generateContent',
          },
        });

      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { error: message });
      }
    });

    const shutdown = () => {
      this.stop();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    return new Promise((resolve) => {
      this.httpServer!.listen(port, host, () => {
        resolve();
      });
    });
  }

  private async handleRESTRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Delegate to REST adapter's internal handling
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname || '/';
    const segments = pathname.split('/').filter(Boolean);

    if (!this.restAdapter) {
      sendJson(res, 503, { success: false, error: 'REST adapter not initialized' });
      return;
    }

    const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') ? await parseBody(req) : {};

    try {
      if (segments[0] === 'api') {
        const resource = segments[1];

        // Health
        if (pathname === '/api/health' || pathname === '/api') {
          sendJson(res, 200, { success: true, data: { status: 'ok', mode: 'rest' }, timestamp: new Date().toISOString() });
          return;
        }

        // Tools
        if (resource === 'tools' && !segments[2] && req.method === 'GET') {
          const tools = this.restAdapter.getToolDefinitions().map(t => ({ name: t.name, description: t.description }));
          sendJson(res, 200, { success: true, data: { tools }, timestamp: new Date().toISOString() });
          return;
        }

        if (resource === 'tools' && segments[2] && req.method === 'POST') {
          const result = await this.restAdapter.callTool(segments[2], body);
          sendJson(res, 200, { success: true, data: result, timestamp: new Date().toISOString() });
          return;
        }

        // Variables
        if (resource === 'variables') {
          if (!segments[2] && req.method === 'GET') {
            const result = await this.restAdapter.callTool('envcp_list', {});
            sendJson(res, 200, { success: true, data: result, timestamp: new Date().toISOString() });
            return;
          }
          if (!segments[2] && req.method === 'POST') {
            const result = await this.restAdapter.callTool('envcp_set', body);
            sendJson(res, 201, { success: true, data: result, timestamp: new Date().toISOString() });
            return;
          }
          if (segments[2] && req.method === 'GET') {
            const result = await this.restAdapter.callTool('envcp_get', { name: segments[2], show_value: parsedUrl.searchParams.get('show_value') === 'true' });
            sendJson(res, 200, { success: true, data: result, timestamp: new Date().toISOString() });
            return;
          }
          if (segments[2] && req.method === 'PUT') {
            const result = await this.restAdapter.callTool('envcp_set', { ...body, name: segments[2] });
            sendJson(res, 200, { success: true, data: result, timestamp: new Date().toISOString() });
            return;
          }
          if (segments[2] && req.method === 'DELETE') {
            const result = await this.restAdapter.callTool('envcp_delete', { name: segments[2] });
            sendJson(res, 200, { success: true, data: result, timestamp: new Date().toISOString() });
            return;
          }
        }

        // Sync
        if (resource === 'sync' && req.method === 'POST') {
          const result = await this.restAdapter.callTool('envcp_sync', {});
          sendJson(res, 200, { success: true, data: result, timestamp: new Date().toISOString() });
          return;
        }

        // Run
        if (resource === 'run' && req.method === 'POST') {
          const result = await this.restAdapter.callTool('envcp_run', body);
          sendJson(res, 200, { success: true, data: result, timestamp: new Date().toISOString() });
          return;
        }
      }

      sendJson(res, 404, { success: false, error: 'Not found', timestamp: new Date().toISOString() });

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { success: false, error: message, timestamp: new Date().toISOString() });
    }
  }

  private async handleOpenAIRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.openaiAdapter) {
      sendJson(res, 503, { error: { message: 'OpenAI adapter not initialized', type: 'service_unavailable' } });
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname || '/';
    const body = req.method === 'POST' ? await parseBody(req) : {};

    try {
      if (pathname === '/v1/models' && req.method === 'GET') {
        sendJson(res, 200, {
          object: 'list',
          data: [{ id: 'envcp-1.0', object: 'model', created: Date.now(), owned_by: 'envcp' }],
        });
        return;
      }

      if (pathname === '/v1/functions' && req.method === 'GET') {
        sendJson(res, 200, { object: 'list', data: this.openaiAdapter.getOpenAIFunctions() });
        return;
      }

      if (pathname === '/v1/functions/call' && req.method === 'POST') {
        const { name, arguments: args } = body as any;
        const result = await this.openaiAdapter.callTool(name, args || {});
        sendJson(res, 200, { object: 'function_result', name, result });
        return;
      }

      if (pathname === '/v1/tool_calls' && req.method === 'POST') {
        const { tool_calls } = body as any;
        const results = await this.openaiAdapter.processToolCalls(tool_calls);
        sendJson(res, 200, { object: 'list', data: results });
        return;
      }

      if (pathname === '/v1/chat/completions' && req.method === 'POST') {
        const messages = (body as any).messages;
        const lastMessage = messages?.[messages.length - 1];
        
        if (lastMessage?.tool_calls) {
          const results = await this.openaiAdapter.processToolCalls(lastMessage.tool_calls);
          sendJson(res, 200, {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            model: 'envcp-1.0',
            choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'tool_calls' }],
            tool_results: results,
          });
          return;
        }

        sendJson(res, 200, {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          model: 'envcp-1.0',
          choices: [{ index: 0, message: { role: 'assistant', content: 'EnvCP tools available.' }, finish_reason: 'stop' }],
          available_tools: this.openaiAdapter.getOpenAIFunctions().map(f => ({ type: 'function', function: f })),
        });
        return;
      }

      sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: { message, type: 'internal_error' } });
    }
  }

  private async handleGeminiRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.geminiAdapter) {
      sendJson(res, 503, { error: { code: 503, message: 'Gemini adapter not initialized', status: 'UNAVAILABLE' } });
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname || '/';
    const body = req.method === 'POST' ? await parseBody(req) : {};

    try {
      if (pathname === '/v1/tools' && req.method === 'GET') {
        sendJson(res, 200, { tools: [{ functionDeclarations: this.geminiAdapter.getGeminiFunctionDeclarations() }] });
        return;
      }

      if (pathname === '/v1/functions/call' && req.method === 'POST') {
        const { name, args } = body as any;
        const result = await this.geminiAdapter.callTool(name, args || {});
        sendJson(res, 200, { name, response: { result } });
        return;
      }

      if (pathname === '/v1/function_calls' && req.method === 'POST') {
        const { functionCalls } = body as any;
        const results = await this.geminiAdapter.processFunctionCalls(functionCalls);
        sendJson(res, 200, { functionResponses: results });
        return;
      }

      if (pathname.includes(':generateContent') && req.method === 'POST') {
        const contents = (body as any).contents;
        const functionCalls: any[] = [];
        
        if (contents) {
          for (const content of contents) {
            for (const part of content.parts || []) {
              if (part.functionCall) functionCalls.push(part.functionCall);
            }
          }
        }

        if (functionCalls.length > 0) {
          const results = await this.geminiAdapter.processFunctionCalls(functionCalls);
          sendJson(res, 200, {
            candidates: [{
              content: { parts: results.map(r => ({ functionResponse: r })), role: 'model' },
              finishReason: 'STOP',
            }],
          });
          return;
        }

        sendJson(res, 200, {
          candidates: [{
            content: { parts: [{ text: 'EnvCP tools available.' }], role: 'model' },
            finishReason: 'STOP',
          }],
          availableTools: [{ functionDeclarations: this.geminiAdapter.getGeminiFunctionDeclarations() }],
        });
        return;
      }

      sendJson(res, 404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: { code: 500, message, status: 'INTERNAL' } });
    }
  }


  stop(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    if (this.restAdapter) {
      this.restAdapter.stopServer();
    }
    if (this.openaiAdapter) {
      this.openaiAdapter.stopServer();
    }
    if (this.geminiAdapter) {
      this.geminiAdapter.stopServer();
    }
  }
}
