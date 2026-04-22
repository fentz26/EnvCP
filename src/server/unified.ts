import { EnvCPConfig, ServerConfig, ClientType } from '../types.js';
import { VERSION } from '../version.js';
import { RESTAdapter } from '../adapters/rest.js';
import { OpenAIAdapter } from '../adapters/openai.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { EnvCPServer } from '../mcp/server.js';
import { resolveVaultPath, resolveSessionPath } from '../vault/index.js';
import { sendJson, parseBody, validateApiKey, RateLimiter, applyServerPreChecks } from '../utils/http.js';
import { LogManager, resolveLogPath } from '../storage/index.js';
import { LockoutManager, resolveBruteForceSettings, buildInvalidApiKeyLogEntry } from '../utils/lockout.js';
import * as http from 'node:http';
import * as path from 'node:path';

export class UnifiedServer {
  private readonly config: EnvCPConfig;
  private readonly serverConfig: ServerConfig;
  private readonly projectPath: string;
  private readonly password?: string;

  private restAdapter: RESTAdapter | null = null;
  private openaiAdapter: OpenAIAdapter | null = null;
  private geminiAdapter: GeminiAdapter | null = null;
  private mcpServer: EnvCPServer | null = null;
  private httpServer: http.Server | null = null;
  private rateLimiter: RateLimiter = new RateLimiter(60, 60000);
  private apiKeyLockoutManager?: LockoutManager;
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
    /* c8 ignore next -- detectClientType is always called with pathname from request routing; the undefined branch is unreachable in practice */
    pathname ??= new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;

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

  private shouldInitRestAdapter(mode: ServerConfig['mode']): boolean {
    return mode === 'rest' || mode === 'all' || mode === 'auto';
  }

  private shouldInitOpenAIAdapter(mode: ServerConfig['mode']): boolean {
    return mode === 'openai' || mode === 'all' || mode === 'auto';
  }

  private shouldInitGeminiAdapter(mode: ServerConfig['mode']): boolean {
    return mode === 'gemini' || mode === 'all' || mode === 'auto';
  }

  private async initAdapters(
    mode: ServerConfig['mode'],
    vaultPath: string,
    sessionPath: string,
  ): Promise<void> {
    if (this.shouldInitRestAdapter(mode)) {
      this.restAdapter = new RESTAdapter(this.config, this.projectPath, this.password, vaultPath, sessionPath);
      await this.restAdapter.init();
    }

    if (this.shouldInitOpenAIAdapter(mode)) {
      this.openaiAdapter = new OpenAIAdapter(this.config, this.projectPath, this.password, vaultPath, sessionPath);
      await this.openaiAdapter.init();
    }

    if (this.shouldInitGeminiAdapter(mode)) {
      this.geminiAdapter = new GeminiAdapter(this.config, this.projectPath, this.password, vaultPath, sessionPath);
      await this.geminiAdapter.init();
    }
  }

  private async startSingleModeServer(
    mode: ServerConfig['mode'],
    port: number,
    host: string,
    apiKey: string | undefined,
    rateLimitConfig: ServerConfig['rate_limit'],
  ): Promise<boolean> {
    if (mode === 'rest') {
      await this.restAdapter!.startServer(port, host, apiKey, rateLimitConfig);
      return true;
    }
    if (mode === 'openai') {
      await this.openaiAdapter!.startServer(port, host, apiKey, rateLimitConfig);
      return true;
    }
    if (mode === 'gemini') {
      await this.geminiAdapter!.startServer(port, host, apiKey, rateLimitConfig);
      return true;
    }
    return false;
  }

  private configureUnifiedRateLimiting(rateLimitConfig: ServerConfig['rate_limit'], sessionPath: string, apiKey?: string): string[] {
    const rateLimitEnabled = rateLimitConfig?.enabled !== false;
    if (rateLimitEnabled) {
      this.rateLimiter?.destroy();
      this.rateLimiter = new RateLimiter(rateLimitConfig?.requests_per_minute ?? 60, 60000);
    }

    const sessionDir = path.dirname(sessionPath);
    this.apiKeyLockoutManager = apiKey ? new LockoutManager(path.join(sessionDir, '.lockout-api')) : undefined;
    return rateLimitConfig?.whitelist ?? [];
  }

  private async handleUnifiedLockout(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<boolean> {
    /* c8 ignore next 3 -- apiKeyLockoutManager is always set when an api_key is configured; defensive guard */
    if (!this.apiKeyLockoutManager) {
      return false;
    }

    const lockoutStatus = await this.apiKeyLockoutManager.check();
    if (!lockoutStatus.locked) {
      const ip = req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      this.apiKeyLockoutManager.setNotificationSource('api', ip, userAgent);
      return false;
    }

    const lockoutLabel = lockoutStatus.permanent_locked
      ? 'permanent lockout'
      : `lockout for ${lockoutStatus.remaining_seconds}s`;
    const errorMessage = lockoutStatus.permanent_locked
      ? 'Authentication permanently locked - recovery required'
      : `Too many failed attempts - try again in ${lockoutStatus.remaining_seconds} seconds`;

    await this.logs?.log({
      timestamp: new Date().toISOString(),
      operation: 'auth_failure',
      variable: '',
      source: 'api',
      success: false,
      /* c8 ignore next -- socket.remoteAddress always set in tests; '?? unknown' fallback is defensive */
      message: `Unified API authentication blocked - ${lockoutLabel} from ${req.socket.remoteAddress ?? 'unknown'}`,
    });

    if (!lockoutStatus.permanent_locked) {
      res.setHeader('Retry-After', lockoutStatus.remaining_seconds.toString());
    }
    sendJson(res, lockoutStatus.permanent_locked ? 403 : 429, { error: errorMessage });
    return true;
  }

  private async handleUnifiedInvalidApiKey(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (this.apiKeyLockoutManager) {
      const { lockoutThreshold, lockoutBaseSeconds, progressiveDelay, maxDelay, permanentThreshold } =
        resolveBruteForceSettings(this.config);

      const status = await this.apiKeyLockoutManager.recordFailure(
        lockoutThreshold,
        lockoutBaseSeconds,
        progressiveDelay,
        maxDelay,
        permanentThreshold,
      );

      if (status.locked) {
        const lockoutLabel = status.permanent_locked
          ? 'permanent lockout'
          : `lockout for ${status.remaining_seconds}s`;
        const errorMessage = status.permanent_locked
          ? 'Authentication permanently locked - recovery required'
          : `Too many failed attempts - try again in ${status.remaining_seconds} seconds`;

        await this.logs?.log(buildInvalidApiKeyLogEntry(req, lockoutLabel));

        if (!status.permanent_locked) {
          res.setHeader('Retry-After', status.remaining_seconds.toString());
        }
        sendJson(res, status.permanent_locked ? 403 : 429, { error: errorMessage });
        return;
      }
    }

    await this.logs?.log(buildInvalidApiKeyLogEntry(req));
    sendJson(res, 401, { error: 'Invalid API key' });
  }

  private async enforceUnifiedApiKey(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    apiKey?: string,
  ): Promise<boolean> {
    if (!apiKey) {
      return true;
    }
    if (await this.handleUnifiedLockout(req, res)) {
      return false;
    }

    const providedKey = (req.headers['x-api-key'] ||
      req.headers['x-goog-api-key'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '')) as string | undefined;
    if (validateApiKey(providedKey, apiKey)) {
      return true;
    }

    await this.handleUnifiedInvalidApiKey(req, res);
    return false;
  }

  private sendUnifiedRootInfo(req: http.IncomingMessage, res: http.ServerResponse, mode: ServerConfig['mode'], pathname: string): void {
    const detectedType = this.serverConfig.auto_detect ? this.detectClientType(req, pathname) : 'unknown';
    sendJson(res, 200, {
      name: 'EnvCP Unified Server',
      version: VERSION,
      mode,
      detected_client: detectedType,
      auto_detect: this.serverConfig.auto_detect,
      available_modes: ['rest', 'openai', 'gemini', 'mcp'],
      endpoints: {
        rest: '/api/*',
        openai: '/v1/chat/completions, /v1/functions/*, /v1/tool_calls',
        gemini: '/v1/models/envcp:generateContent, /v1/function_calls',
      },
    });
  }

  private resolveUnifiedClientType(req: http.IncomingMessage, pathname: string, parsedUrl: URL): ClientType {
    const detectedType = this.serverConfig.auto_detect ? this.detectClientType(req, pathname) : 'unknown';
    const forceMode = parsedUrl.searchParams.get('mode');
    if (forceMode === 'rest' || forceMode === 'openai' || forceMode === 'gemini') {
      return forceMode;
    }
    return detectedType;
  }

  private isOpenAIRoute(pathname: string): boolean {
    return pathname.startsWith('/v1/chat')
      || pathname.startsWith('/v1/functions')
      || pathname === '/v1/tool_calls'
      || pathname === '/v1/models';
  }

  private isGeminiRoute(pathname: string): boolean {
    return pathname.includes(':generateContent')
      || pathname === '/v1/function_calls'
      || pathname === '/v1/tools';
  }

  private async routeUnifiedRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedUrl: URL,
    clientType: ClientType,
  ): Promise<boolean> {
    const pathname = parsedUrl.pathname;

    if ((clientType === 'rest' || clientType === 'unknown') && pathname.startsWith('/api')) {
      await this.handleRESTRequest(req, res, parsedUrl);
      return true;
    }
    if (clientType === 'openai' || this.isOpenAIRoute(pathname)) {
      await this.handleOpenAIRequest(req, res, parsedUrl);
      return true;
    }
    if (clientType === 'gemini' || this.isGeminiRoute(pathname)) {
      await this.handleGeminiRequest(req, res, parsedUrl);
      return true;
    }
    if (pathname.startsWith('/api')) {
      await this.handleRESTRequest(req, res, parsedUrl);
      return true;
    }
    return false;
  }

  private registerShutdownHandlers(): void {
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
    this.logs = new LogManager(resolveLogPath(this.config.audit, this.projectPath), this.config.audit);
    await this.logs.init();

    // MCP mode uses stdio, not HTTP
    if (mode === 'mcp') {
      this.mcpServer = new EnvCPServer(this.config, this.projectPath, this.password, vaultPath, sessionPath);
      await this.mcpServer.start();
      return;
    }

    // Warn if AI access is enabled without an API key
    this.checkApiKeySecurity();

    await this.initAdapters(mode, vaultPath, sessionPath);

    const rateLimitConfig = this.serverConfig.rate_limit;
    if (await this.startSingleModeServer(mode, port, host, api_key, rateLimitConfig)) {
      return;
    }

    const rateLimitEnabled = rateLimitConfig?.enabled !== false;
    const whitelist = this.configureUnifiedRateLimiting(rateLimitConfig, sessionPath, api_key);
    this.httpServer = http.createServer(async (req, res) => {
      if (!await applyServerPreChecks(req, res, {
        rateLimiter: this.rateLimiter,
        rateLimitEnabled,
        whitelist,
        enforceApiKey: () => this.enforceUnifiedApiKey(req, res, api_key),
      })) {
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // Root endpoint - show server info and detected mode
      if (pathname === '/' && req.method === 'GET') {
        this.sendUnifiedRootInfo(req, res, mode, pathname);
        return;
      }

      const clientType = this.resolveUnifiedClientType(req, pathname, parsedUrl);

      try {
        if (await this.routeUnifiedRequest(req, res, parsedUrl, clientType)) {
          return;
        }

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

    this.registerShutdownHandlers();

    return new Promise((resolve) => {
      this.httpServer!.listen(port, host, () => {
        resolve();
      });
    });
  }

  private async dispatchVariablesRoute(
    restAdapter: NonNullable<typeof this.restAdapter>,
    res: http.ServerResponse,
    method: string,
    name: string | undefined,
    url: URL,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    if (!name && method === 'GET') {
      const result = await restAdapter.callTool('envcp_list', {});
      sendJson(res, 200, { success: true, data: result, timestamp: now });
      return true;
    }
    if (!name && method === 'POST') {
      const result = await restAdapter.callTool('envcp_set', body);
      sendJson(res, 201, { success: true, data: result, timestamp: now });
      return true;
    }
    if (name && method === 'GET') {
      const result = await restAdapter.callTool('envcp_get', { name, show_value: url.searchParams.get('show_value') === 'true' });
      sendJson(res, 200, { success: true, data: result, timestamp: now });
      return true;
    }
    if (name && method === 'PUT') {
      const result = await restAdapter.callTool('envcp_set', { ...body, name });
      sendJson(res, 200, { success: true, data: result, timestamp: now });
      return true;
    }
    if (name && method === 'DELETE') {
      const result = await restAdapter.callTool('envcp_delete', { name });
      sendJson(res, 200, { success: true, data: result, timestamp: now });
      return true;
    }
    return false;
  }

  private async dispatchToolsRoute(
    restAdapter: NonNullable<typeof this.restAdapter>,
    res: http.ServerResponse,
    method: string,
    toolName: string | undefined,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    if (!toolName && method === 'GET') {
      const tools = restAdapter.getToolDefinitions().map(t => ({ name: t.name, description: t.description }));
      sendJson(res, 200, { success: true, data: { tools }, timestamp: now });
      return true;
    }
    if (toolName && method === 'POST') {
      const result = await restAdapter.callTool(toolName, body);
      sendJson(res, 200, { success: true, data: result, timestamp: now });
      return true;
    }
    /* c8 ignore next 2 -- defensive fallback for unsupported method/toolName combinations on /api/tools */
    return false;
  }

  private async handleRESTRequest(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl?: URL): Promise<void> {
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
    /* c8 ignore next -- req.method is always set on incoming HTTP messages; 'GET' fallback unreachable */
    const method = req.method || 'GET';
    const now = new Date().toISOString();

    try {
      if (segments[0] !== 'api') {
        sendJson(res, 404, { success: false, error: 'Not found', timestamp: now });
        return;
      }

      if (pathname === '/api/health' || pathname === '/api') {
        sendJson(res, 200, { success: true, data: { status: 'ok', mode: 'rest' }, timestamp: now });
        return;
      }

      const resource = segments[1];

      if (resource === 'tools' && await this.dispatchToolsRoute(this.restAdapter, res, method, segments[2], body)) {
        return;
      }

      if (resource === 'variables' && await this.dispatchVariablesRoute(this.restAdapter, res, method, segments[2], url, body)) {
        return;
      }

      if (resource === 'sync' && method === 'POST') {
        const result = await this.restAdapter.callTool('envcp_sync', {});
        sendJson(res, 200, { success: true, data: result, timestamp: now });
        return;
      }

      if (resource === 'run' && method === 'POST') {
        const result = await this.restAdapter.callTool('envcp_run', body);
        sendJson(res, 200, { success: true, data: result, timestamp: now });
        return;
      }

      sendJson(res, 404, { success: false, error: 'Not found', timestamp: now });

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { success: false, error: message, timestamp: new Date().toISOString() });
    }
  }

  private async handleOpenAIChatCompletions(
    openaiAdapter: NonNullable<typeof this.openaiAdapter>,
    res: http.ServerResponse,
    body: Record<string, unknown>,
  ): Promise<void> {
    const { messages: rawMessages } = body as { messages?: unknown };
    const messages = Array.isArray(rawMessages) ? rawMessages : [];
    const lastMessage = messages.at(-1);

    if (lastMessage?.tool_calls) {
      const results = await openaiAdapter.processToolCalls(lastMessage.tool_calls);
      sendJson(res, 200, openaiAdapter.createToolResultsCompletion(results));
      return;
    }

    sendJson(res, 200, openaiAdapter.createAvailableToolsCompletion());
  }

  private async handleOpenAIFunctionCall(res: http.ServerResponse, body: Record<string, unknown>): Promise<void> {
    const b = body as { name?: unknown; arguments?: unknown };
    const name = typeof b.name === 'string' ? b.name : '';
    const args = (b.arguments && typeof b.arguments === 'object') ? b.arguments as Record<string, unknown> : {};
    const result = await this.openaiAdapter!.callTool(name, args);
    sendJson(res, 200, { object: 'function_result', name, result });
  }

  private async handleOpenAIToolCalls(res: http.ServerResponse, body: Record<string, unknown>): Promise<void> {
    const { tool_calls } = body as { tool_calls?: unknown };
    const results = await this.openaiAdapter!.processToolCalls(Array.isArray(tool_calls) ? tool_calls : []);
    sendJson(res, 200, { object: 'list', data: results });
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
    /* c8 ignore next -- req.method is always set on incoming HTTP messages; 'GET' fallback unreachable */
    const method = req.method || 'GET';

    try {
      if (pathname === '/v1/models' && method === 'GET') {
        sendJson(res, 200, {
          object: 'list',
          data: [{ id: 'envcp-1.0', object: 'model', created: Date.now(), owned_by: 'envcp' }],
        });
        return;
      }

      if (pathname === '/v1/functions' && method === 'GET') {
        sendJson(res, 200, this.openaiAdapter.createFunctionsListResponse());
        return;
      }

      if (pathname === '/v1/functions/call' && method === 'POST') {
        await this.handleOpenAIFunctionCall(res, body);
        return;
      }

      if (pathname === '/v1/tool_calls' && method === 'POST') {
        await this.handleOpenAIToolCalls(res, body);
        return;
      }

      if (pathname === '/v1/chat/completions' && method === 'POST') {
        await this.handleOpenAIChatCompletions(this.openaiAdapter, res, body);
        return;
      }

      sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: { message, type: 'internal_error' } });
    }
  }

  private extractGeminiFunctionCalls(contents: unknown): Array<{ name: string; args: Record<string, unknown> }> {
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    if (!Array.isArray(contents)) return functionCalls;
    for (const content of contents) {
      const parts = (content && typeof content === 'object' && Array.isArray((content as Record<string, unknown>).parts))
        ? (content as Record<string, unknown>).parts as unknown[]
        : [];
      for (const part of parts) {
        const p = part as Record<string, unknown>;
        if (p.functionCall) functionCalls.push(p.functionCall as { name: string; args: Record<string, unknown> });
      }
    }
    return functionCalls;
  }

  private async handleGeminiGenerateContent(
    geminiAdapter: NonNullable<typeof this.geminiAdapter>,
    res: http.ServerResponse,
    body: Record<string, unknown>,
  ): Promise<void> {
    const { contents } = body as { contents?: unknown };
    const functionCalls = this.extractGeminiFunctionCalls(contents);

    if (functionCalls.length > 0) {
      const results = await geminiAdapter.processFunctionCalls(functionCalls);
      sendJson(res, 200, geminiAdapter.createGenerateContentResponse(results));
      return;
    }

    sendJson(res, 200, geminiAdapter.createAvailableToolsResponse());
  }

  private async handleGeminiFunctionCall(res: http.ServerResponse, body: Record<string, unknown>): Promise<void> {
    const bg = body as { name?: unknown; args?: unknown };
    /* c8 ignore next -- function name validation always returns string for valid requests; the else branch is unreachable in practice */
    const name = typeof bg.name === 'string' ? bg.name : '';
    const args = (bg.args && typeof bg.args === 'object') ? bg.args as Record<string, unknown> : {};
    const result = await this.geminiAdapter!.callTool(name, args);
    sendJson(res, 200, { name, response: { result } });
  }

  private async handleGeminiFunctionCalls(res: http.ServerResponse, body: Record<string, unknown>): Promise<void> {
    const { functionCalls: rawFunctionCalls } = body as { functionCalls?: unknown };
    const results = await this.geminiAdapter!.processFunctionCalls(Array.isArray(rawFunctionCalls) ? rawFunctionCalls : []);
    sendJson(res, 200, { functionResponses: results });
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
    /* c8 ignore next -- req.method is always set on incoming HTTP messages; 'GET' fallback unreachable */
    const method = req.method || 'GET';

    try {
      if (pathname === '/v1/tools' && method === 'GET') {
        sendJson(res, 200, this.geminiAdapter.createToolsListResponse());
        return;
      }

      if (pathname === '/v1/functions/call' && method === 'POST') {
        await this.handleGeminiFunctionCall(res, body);
        return;
      }

      if (pathname === '/v1/function_calls' && method === 'POST') {
        await this.handleGeminiFunctionCalls(res, body);
        return;
      }

      if (pathname.includes(':generateContent') && method === 'POST') {
        await this.handleGeminiGenerateContent(this.geminiAdapter, res, body);
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
