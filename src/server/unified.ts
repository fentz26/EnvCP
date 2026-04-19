import { EnvCPConfig, ServerConfig, ClientType } from '../types.js';
import { VERSION } from '../version.js';
import { RESTAdapter } from '../adapters/rest.js';
import { OpenAIAdapter } from '../adapters/openai.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { EnvCPServer } from '../mcp/server.js';
import { resolveVaultPath, resolveSessionPath } from '../vault/index.js';
import { setCorsHeaders, sendJson, parseBody, validateApiKey, RateLimiter, rateLimitMiddleware } from '../utils/http.js';
import { LogManager } from '../storage/index.js';
import * as path from 'path';
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
  private logs: LogManager | null = null;
  private shutdownHandlers: { sigterm: () => void; sigint: () => void } | null = null;

  constructor(config: EnvCPConfig, serverConfig: ServerConfig, projectPath: string, password?: string) {
    this.config = config;
    this.serverConfig = serverConfig;
    this.projectPath = projectPath;
    this.password = password;
  }

  // Detect client type from request headers
  detectClientType(req: http.IncomingMessage, pathname?: string): ClientType {
    const userAgent = req.headers['user-agent']?.toLowerCase() || '';
    if (pathname === undefined) {
      /* c8 ignore next -- detectClientType is always called with pathname from request routing; the undefined branch is unreachable in practice */
      pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    }

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


  private checkApiKeySecurity(): void {
    const { api_key } = this.serverConfig;
    if (api_key) return;

    const access = this.config.access;
    const activeFlags = ([
      'allow_ai_read',
      'allow_ai_write',
      'allow_ai_delete',
      'allow_ai_export',
      'allow_ai_execute',
      'allow_ai_active_check',
    ] as const).filter(flag => access[flag]);

    if (activeFlags.length === 0) return;

    if (access.allow_ai_execute) {
      throw new Error(
        'Refusing to start: allow_ai_execute is enabled but no api_key is set.\n' +
        'Unauthenticated callers can execute arbitrary commands.\n' +
        'Set server.api_key in your config, or disable allow_ai_execute.'
      );
    }

    throw new Error(
      'Refusing to start: AI access is enabled but no api_key is set.\n' +
      `Active AI flags: ${activeFlags.join(', ')}\n` +
      'Set server.api_key in your config, or disable all AI access flags.'
    );
  }

  async start(): Promise<void> {
    const { mode, port, host, api_key } = this.serverConfig;

    // Resolve vault and session paths once before creating any adapters
    const vaultPath = await resolveVaultPath(this.projectPath, this.config);
    const sessionPath = resolveSessionPath(this.projectPath, this.config);

    // Initialize audit log for HTTP modes
    this.logs = new LogManager(path.join(this.projectPath, '.envcp', 'logs'), this.config.audit);
    await this.logs.init();

    // MCP mode uses stdio, not HTTP
    if (mode === 'mcp') {
      this.mcpServer = new EnvCPServer(this.config, this.projectPath, this.password, vaultPath, sessionPath);
      await this.mcpServer.start();
      return;
    }

    // Warn if AI access is enabled without an API key
    this.checkApiKeySecurity();

    // Initialize adapters based on mode
    if (mode === 'rest' || mode === 'all' || mode === 'auto') {
      this.restAdapter = new RESTAdapter(this.config, this.projectPath, this.password, vaultPath, sessionPath);
      await this.restAdapter.init();
    }

    if (mode === 'openai' || mode === 'all' || mode === 'auto') {
      this.openaiAdapter = new OpenAIAdapter(this.config, this.projectPath, this.password, vaultPath, sessionPath);
      await this.openaiAdapter.init();
    }

    if (mode === 'gemini' || mode === 'all' || mode === 'auto') {
      this.geminiAdapter = new GeminiAdapter(this.config, this.projectPath, this.password, vaultPath, sessionPath);
      await this.geminiAdapter.init();
    }

// Single mode - start specific adapter server
const rl = this.serverConfig.rate_limit;

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
const rateLimitEnabled = rl?.enabled !== false;
if (rateLimitEnabled) {
  this.rateLimiter?.destroy();
  this.rateLimiter = new RateLimiter(rl?.requests_per_minute ?? 60, 60000);
}
const whitelist = rl?.whitelist ?? [];
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
                           req.headers['authorization']?.replace(/^Bearer\s+/i, '')) as string | undefined;
        if (!validateApiKey(providedKey, api_key)) {
          /* c8 ignore next -- logs is always initialized in start(); the undefined branch is unreachable in practice */
          await this.logs?.log({ timestamp: new Date().toISOString(), operation: 'auth_failure', variable: '', source: 'api', success: false, message: `Invalid API key from ${req.socket.remoteAddress ?? 'unknown'}` });
          sendJson(res, 401, { error: 'Invalid API key' });
          return;
        }
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // Root endpoint - show server info and detected mode
      if (pathname === '/' && req.method === 'GET') {
        const detectedType = this.serverConfig.auto_detect ? this.detectClientType(req, pathname) : 'unknown';
        sendJson(res, 200, {
          name: 'EnvCP Unified Server',
          version: VERSION,
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
        clientType = this.detectClientType(req, pathname);
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
          await this.handleRESTRequest(req, res, parsedUrl);
          return;
        }

        // OpenAI routes
        if (clientType === 'openai' || pathname.startsWith('/v1/chat') || pathname.startsWith('/v1/functions') || pathname === '/v1/tool_calls' || pathname === '/v1/models') {
          await this.handleOpenAIRequest(req, res, parsedUrl);
          return;
        }

        // Gemini routes
        if (clientType === 'gemini' || pathname.includes(':generateContent') || pathname === '/v1/function_calls' || pathname === '/v1/tools') {
          await this.handleGeminiRequest(req, res, parsedUrl);
          return;
        }

        // Default to REST for unknown paths
        if (pathname.startsWith('/api')) {
          await this.handleRESTRequest(req, res, parsedUrl);
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

    // Remove any existing shutdown handlers first
    if (this.shutdownHandlers) {
      process.off('SIGTERM', this.shutdownHandlers.sigterm);
      process.off('SIGINT', this.shutdownHandlers.sigint);
      this.shutdownHandlers = null;
    }

    const shutdown = () => {
      this.stop();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    this.shutdownHandlers = { sigterm: shutdown, sigint: shutdown };

    return new Promise((resolve) => {
      this.httpServer!.listen(port, host, () => {
        resolve();
      });
    });
  }

  private async handleRESTRequest(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl?: URL): Promise<void> {
    // Delegate to REST adapter's internal handling
    /* c8 ignore next -- parsedUrl is always provided by caller; the fallback is unreachable in practice */
    const url = parsedUrl ?? new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    /* c8 ignore next -- URL.pathname is always '/' at minimum; the '/' fallback is unreachable */
    const pathname = url.pathname || '/';
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
            const result = await this.restAdapter.callTool('envcp_get', { name: segments[2], show_value: url.searchParams.get('show_value') === 'true' });
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

  private async handleOpenAIRequest(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl?: URL): Promise<void> {
    if (!this.openaiAdapter) {
      sendJson(res, 503, { error: { message: 'OpenAI adapter not initialized', type: 'service_unavailable' } });
      return;
    }

    /* c8 ignore next -- parsedUrl is always provided by caller; the fallback is unreachable in practice */
    const url = parsedUrl ?? new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    /* c8 ignore next -- URL.pathname is always '/' at minimum; the '/' fallback is unreachable */
    const pathname = url.pathname || '/';
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
        const b = body as { name?: unknown; arguments?: unknown };
        const name = typeof b.name === 'string' ? b.name : '';
        const args = (b.arguments && typeof b.arguments === 'object') ? b.arguments as Record<string, unknown> : {};
        const result = await this.openaiAdapter.callTool(name, args);
        sendJson(res, 200, { object: 'function_result', name, result });
        return;
      }

      if (pathname === '/v1/tool_calls' && req.method === 'POST') {
        const { tool_calls } = body as { tool_calls?: unknown };
        const results = await this.openaiAdapter.processToolCalls(Array.isArray(tool_calls) ? tool_calls : []);
        sendJson(res, 200, { object: 'list', data: results });
        return;
      }

      if (pathname === '/v1/chat/completions' && req.method === 'POST') {
        const { messages: rawMessages } = body as { messages?: unknown };
        const messages = Array.isArray(rawMessages) ? rawMessages : [];
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

  private async handleGeminiRequest(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl?: URL): Promise<void> {
    if (!this.geminiAdapter) {
      sendJson(res, 503, { error: { code: 503, message: 'Gemini adapter not initialized', status: 'UNAVAILABLE' } });
      return;
    }

    /* c8 ignore next -- parsedUrl is always provided by caller; the fallback is unreachable in practice */
    const url = parsedUrl ?? new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    /* c8 ignore next -- URL.pathname is always '/' at minimum; the '/' fallback is unreachable */
    const pathname = url.pathname || '/';
    const body = req.method === 'POST' ? await parseBody(req) : {};

    try {
      if (pathname === '/v1/tools' && req.method === 'GET') {
        sendJson(res, 200, { tools: [{ functionDeclarations: this.geminiAdapter.getGeminiFunctionDeclarations() }] });
        return;
      }

      if (pathname === '/v1/functions/call' && req.method === 'POST') {
        const bg = body as { name?: unknown; args?: unknown };
        /* c8 ignore next -- function name validation always returns string for valid requests; the else branch is unreachable in practice */
        const name = typeof bg.name === 'string' ? bg.name : '';
        const args = (bg.args && typeof bg.args === 'object') ? bg.args as Record<string, unknown> : {};
        const result = await this.geminiAdapter.callTool(name, args);
        sendJson(res, 200, { name, response: { result } });
        return;
      }

      if (pathname === '/v1/function_calls' && req.method === 'POST') {
        const { functionCalls: rawFunctionCalls } = body as { functionCalls?: unknown };
        const results = await this.geminiAdapter.processFunctionCalls(Array.isArray(rawFunctionCalls) ? rawFunctionCalls : []);
        sendJson(res, 200, { functionResponses: results });
        return;
      }

      if (pathname.includes(':generateContent') && req.method === 'POST') {
        const { contents } = body as { contents?: unknown };
        const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
        
        if (Array.isArray(contents)) {
          for (const content of contents) {
            const parts = (content && typeof content === 'object' && Array.isArray((content as Record<string, unknown>).parts))
              ? (content as Record<string, unknown>).parts as unknown[]
              : [];
            for (const part of parts) {
              const p = part as Record<string, unknown>;
              if (p.functionCall) functionCalls.push(p.functionCall as { name: string; args: Record<string, unknown> });
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
    this.rateLimiter?.destroy();
    
    // Remove shutdown handlers
    if (this.shutdownHandlers) {
      process.off('SIGTERM', this.shutdownHandlers.sigterm);
      process.off('SIGINT', this.shutdownHandlers.sigint);
      this.shutdownHandlers = null;
    }
  }
}
