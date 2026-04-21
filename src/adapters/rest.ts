import { BaseAdapter } from './base.js';
import { EnvCPConfig, RESTResponse, ToolDefinition, RateLimitConfig } from '../types.js';
import { VERSION } from '../version.js';
import { setCorsHeaders, sendJson, parseBody, validateApiKey, RateLimiter, rateLimitMiddleware } from '../utils/http.js';
import { LockoutManager } from '../utils/lockout.js';
import { resolveSessionPath } from '../vault/index.js';
import * as http from 'node:http';
import * as path from 'node:path';

export class RESTAdapter extends BaseAdapter {
  private server: http.Server | null = null;
  private rateLimiter = new RateLimiter(60, 60000);
  private lockoutManager?: LockoutManager;

  constructor(config: EnvCPConfig, projectPath: string, password?: string, vaultPath?: string, sessionPath?: string) {
    super(config, projectPath, password, vaultPath, sessionPath);

    if (password) {
      this.scheduleApiKeyLockoutClear();
    }
  }

  private scheduleApiKeyLockoutClear(): void {
    /* c8 ignore next 3 -- fire-and-forget reset path is verified by integration behavior */
    this.clearApiKeyLockout().catch(() => {
      // Silently ignore errors
    });
  }

  private async clearApiKeyLockout(): Promise<void> {
    const sessionDir = path.dirname(resolveSessionPath(this.projectPath, this.config));
    const lockoutPath = path.join(sessionDir, '.lockout-api');
    const lockoutManager = new LockoutManager(lockoutPath);
    await lockoutManager.reset();
  }

  protected registerTools(): void {
    const tools: ToolDefinition[] = [
      {
        name: 'envcp_list',
        description: 'List all available environment variable names',
        parameters: {
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        },
        handler: async (params) => this.listVariables(params as { tags?: string[] }),
      },
      {
        name: 'envcp_get',
        description: 'Get an environment variable',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
          show_value: { type: 'boolean', description: 'Show actual value' },
        },
        handler: async (params) => this.getVariable(params as { name: string; show_value?: boolean }),
      },
      {
        name: 'envcp_set',
        description: 'Create or update an environment variable',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
          value: { type: 'string', required: true, description: 'Variable value' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
          description: { type: 'string', description: 'Description' },
        },
        handler: async (params) => this.setVariable(params as { name: string; value: string; tags?: string[]; description?: string }),
      },
      {
        name: 'envcp_delete',
        description: 'Delete an environment variable',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
        },
        handler: async (params) => this.deleteVariable(params as { name: string }),
      },
      {
        name: 'envcp_sync',
        description: 'Sync variables to .env file',
        parameters: {},
        handler: async () => this.syncToEnv(),
      },
      {
        name: 'envcp_add_to_env',
        description: 'Add variable to .env file',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
          env_file: { type: 'string', description: 'Path to .env file' },
        },
        handler: async (params) => this.addToEnv(params as { name: string; env_file?: string }),
      },
      {
        name: 'envcp_check_access',
        description: 'Check if a variable can be accessed',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
        },
        handler: async (params) => this.checkAccess(params as { name: string }),
      },
      {
        name: 'envcp_run',
        description: 'Execute a command with environment variables',
        parameters: {
          command: { type: 'string', required: true, description: 'Command to execute' },
          variables: { type: 'array', items: { type: 'string' }, required: true, description: 'Variables to inject' },
        },
        handler: async (params) => this.runCommand(params as { command: string; variables: string[] }),
      },
      {
        name: 'envcp_logs',
        description: 'Read filtered audit log entries (requires access.allow_ai_logs: true)',
        parameters: {
          date: { type: 'string', description: 'Log date (YYYY-MM-DD, default: today)' },
          operation: { type: 'string', description: 'Filter by operation' },
          variable: { type: 'string', description: 'Filter by variable name' },
          source: { type: 'string', description: 'Filter by source (cli/mcp/api)' },
          success: { type: 'boolean', description: 'Filter by success or failure' },
          tail: { type: 'number', description: 'Return only the last N entries (max 100)' },
        },
        handler: async (params) => this.readLogs(params as {
          date?: string; operation?: string; variable?: string; source?: string; success?: boolean; tail?: number;
        }),
      },
    ];

    tools.forEach(tool => this.tools.set(tool.name, tool));
  }

  private createResponse<T>(success: boolean, data?: T, error?: string): RESTResponse<T> {
    return {
      success,
      data,
      error,
      timestamp: new Date().toISOString(),
    };
  }

  private initLockoutManager(): void {
    const bfpConfig = this.config.security?.brute_force_protection;
    if (!bfpConfig || bfpConfig.enabled === false) {
      this.lockoutManager = undefined;
      return;
    }

    const sessionDir = path.dirname(resolveSessionPath(this.projectPath, this.config));
    const lockoutPath = path.join(sessionDir, '.lockout-api');
    this.lockoutManager = new LockoutManager(lockoutPath);
  }

  private async rejectLockedRequest(
    res: http.ServerResponse,
    logMessage: string,
    responseMessage: string,
    statusCode: 403 | 429,
    req: http.IncomingMessage,
  ): Promise<void> {
    if (statusCode === 429 && this.lockoutManager) {
      const lockoutStatus = await this.lockoutManager.check();
      res.setHeader('Retry-After', lockoutStatus.remaining_seconds.toString());
    }
    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'auth_failure',
      variable: '',
      source: 'api',
      success: false,
      message: `${logMessage} from ${req.socket.remoteAddress ?? 'unknown'}`,
    });
    sendJson(res, statusCode, this.createResponse(false, undefined, responseMessage));
  }

  private buildLockoutMessages(
    remainingSeconds: number,
    permanentLocked: boolean,
    kind: 'blocked' | 'invalid',
  ): { logMessage: string; responseMessage: string } {
    const logPrefix = kind === 'blocked' ? 'API authentication blocked' : 'Invalid API key';
    const logMessage = permanentLocked
      ? `${logPrefix} - permanent lockout`
      : `${logPrefix} - lockout for ${remainingSeconds}s`;
    const responseMessage = permanentLocked
      ? 'Authentication permanently locked - recovery required'
      : `Too many failed attempts - try again in ${remainingSeconds} seconds`;
    return { logMessage, responseMessage };
  }

  private async checkExistingLockout(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (!this.lockoutManager) return true;
    const lockoutStatus = await this.lockoutManager.check();
    if (lockoutStatus.locked) {
      const { logMessage, responseMessage } = this.buildLockoutMessages(
        lockoutStatus.remaining_seconds,
        lockoutStatus.permanent_locked,
        'blocked',
      );
      await this.rejectLockedRequest(
        res,
        logMessage,
        responseMessage,
        lockoutStatus.permanent_locked ? 403 : 429,
        req,
      );
      return false;
    }
    const ip = req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    this.lockoutManager.setNotificationSource('api', ip, userAgent);
    return true;
  }

  private async recordInvalidKey(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (!this.lockoutManager) return true;
    const bfpConfig = this.config.security?.brute_force_protection;
    /* c8 ignore next 5 -- Zod always provides BFP fields; fallback ?? branches unreachable */
    const lockoutThreshold = bfpConfig?.max_attempts ?? this.config.session?.lockout_threshold ?? 5;
    const lockoutBaseSeconds = bfpConfig?.lockout_duration ?? this.config.session?.lockout_base_seconds ?? 60;
    const progressiveDelay = bfpConfig?.progressive_delay ?? true;
    const maxDelay = bfpConfig?.max_delay ?? 60;
    const permanentThreshold = bfpConfig?.permanent_lockout_threshold ?? 0;

    const status = await this.lockoutManager.recordFailure(
      lockoutThreshold,
      lockoutBaseSeconds,
      progressiveDelay,
      maxDelay,
      permanentThreshold,
    );

    if (status.locked) {
      const { logMessage, responseMessage } = this.buildLockoutMessages(
        status.remaining_seconds,
        status.permanent_locked,
        'invalid',
      );
      await this.rejectLockedRequest(res, logMessage, responseMessage, status.permanent_locked ? 403 : 429, req);
      return false;
    }
    return true;
  }

  private async enforceApiKey(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    apiKey?: string,
  ): Promise<boolean> {
    if (!apiKey) {
      return true;
    }

    if (!(await this.checkExistingLockout(req, res))) {
      return false;
    }

    const providedKey = (req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '')) as string | undefined;
    if (validateApiKey(providedKey, apiKey)) {
      return true;
    }

    if (!(await this.recordInvalidKey(req, res))) {
      return false;
    }

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'auth_failure',
      variable: '',
      source: 'api',
      success: false,
      message: `Invalid API key from ${req.socket.remoteAddress ?? 'unknown'}`,
    });
    sendJson(res, 401, this.createResponse(false, undefined, 'Invalid API key'));
    return false;
  }

  private getClientId(req: http.IncomingMessage): string {
    const clientIdHeader = req.headers['x-envcp-client-id'];
    /* c8 ignore next -- HTTP/1.1 joins duplicate headers; array branch unreachable in practice */
    return (Array.isArray(clientIdHeader) ? clientIdHeader[0] : clientIdHeader) || 'api';
  }

  private getErrorStatus(message: string): number {
    if (message.includes('locked')) return 401;
    if (message.includes('not found')) return 404;
    if (message.includes('disabled')) return 403;
    return 500;
  }

  private async handleApiRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedUrl: URL,
    segments: string[],
    clientId: string,
  ): Promise<boolean> {
    const pathname = parsedUrl.pathname;
    const resource = segments[1];

    if (pathname === '/api/health' || pathname === '/api') {
      sendJson(res, 200, this.createResponse(true, { status: 'ok', version: VERSION, mode: 'rest' }));
      return true;
    }

    if (resource === 'tools' && !segments[2] && req.method === 'GET') {
      const tools = this.getToolDefinitions().map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
      sendJson(res, 200, this.createResponse(true, { tools }));
      return true;
    }

    if (resource === 'tools' && segments[2] && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await this.callTool(segments[2], body, clientId);
      sendJson(res, 200, this.createResponse(true, result));
      return true;
    }

    if (resource === 'variables') {
      return this.handleVariableRoute(req, res, parsedUrl, segments[2], clientId);
    }

    if (resource === 'sync' && req.method === 'POST') {
      const result = await this.callTool('envcp_sync', {}, clientId);
      sendJson(res, 200, this.createResponse(true, result));
      return true;
    }

    if (resource === 'run' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await this.callTool('envcp_run', body, clientId);
      sendJson(res, 200, this.createResponse(true, result));
      return true;
    }

    if (resource === 'access' && segments[2] && req.method === 'GET') {
      const result = await this.callTool('envcp_check_access', { name: segments[2] }, clientId);
      sendJson(res, 200, this.createResponse(true, result));
      return true;
    }

    return false;
  }

  private async handleVariableRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedUrl: URL,
    variableName: string | undefined,
    clientId: string,
  ): Promise<boolean> {
    if (!variableName && req.method === 'GET') {
      const tagsParam = parsedUrl.searchParams.getAll('tags');
      const tags = tagsParam.length > 0 ? tagsParam : undefined;
      const result = await this.callTool('envcp_list', { tags }, clientId);
      sendJson(res, 200, this.createResponse(true, result));
      return true;
    }

    if (!variableName && req.method === 'POST') {
      const body = await parseBody(req);
      const result = await this.callTool('envcp_set', body, clientId);
      sendJson(res, 201, this.createResponse(true, result));
      return true;
    }

    if (variableName && req.method === 'GET') {
      const showValue = parsedUrl.searchParams.get('show_value') === 'true';
      const result = await this.callTool('envcp_get', { name: variableName, show_value: showValue }, clientId);
      sendJson(res, 200, this.createResponse(true, result));
      return true;
    }

    if (variableName && req.method === 'PUT') {
      const body = await parseBody(req);
      const result = await this.callTool('envcp_set', { ...body, name: variableName }, clientId);
      sendJson(res, 200, this.createResponse(true, result));
      return true;
    }

    if (variableName && req.method === 'DELETE') {
      const result = await this.callTool('envcp_delete', { name: variableName }, clientId);
      sendJson(res, 200, this.createResponse(true, result));
      return true;
    }

    return false;
  }

  async startServer(port: number, host: string, apiKey?: string, rateLimitConfig?: RateLimitConfig): Promise<void> {
    await this.init();

    const rateLimitEnabled = rateLimitConfig?.enabled !== false;
    if (rateLimitEnabled) {
      this.rateLimiter?.destroy();
      this.rateLimiter = new RateLimiter(rateLimitConfig?.requests_per_minute ?? 60, 60000);
    }
    const whitelist = rateLimitConfig?.whitelist ?? [];
    this.initLockoutManager();

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

      if (!await this.enforceApiKey(req, res, apiKey)) {
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      const clientId = this.getClientId(req);

      try {
        if (segments[0] === 'api' && await this.handleApiRoute(req, res, parsedUrl, segments, clientId)) {
          return;
        }

        sendJson(res, 404, this.createResponse(false, undefined, 'Not found'));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, this.getErrorStatus(message), this.createResponse(false, undefined, message));
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

  getApiDocs(): string {
    return `
EnvCP REST API
==============

Base URL: http://localhost:{port}/api

Authentication:
  Header: X-API-Key: {your-api-key}
  Or: Authorization: Bearer {your-api-key}

Endpoints:

GET  /api/health                    - Health check
GET  /api/tools                     - List available tools
POST /api/tools/:name               - Call a tool by name

GET  /api/variables                 - List all variables
GET  /api/variables/:name           - Get a variable
POST /api/variables                 - Create a variable
PUT  /api/variables/:name           - Update a variable
DELETE /api/variables/:name         - Delete a variable

POST /api/sync                      - Sync to .env file
POST /api/run                       - Run command with variables
GET  /api/access/:name              - Check variable access

Response format:
{
  "success": true/false,
  "data": { ... },
  "error": "Error message (if any)",
  "timestamp": "ISO timestamp"
}
`.trim();
  }
}
