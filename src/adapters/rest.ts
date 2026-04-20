import { BaseAdapter } from './base.js';
import { EnvCPConfig, RESTResponse, ToolDefinition, RateLimitConfig } from '../types.js';
import { VERSION } from '../version.js';
import { setCorsHeaders, sendJson, parseBody, validateApiKey, RateLimiter, rateLimitMiddleware } from '../utils/http.js';
import { LockoutManager } from '../utils/lockout.js';
import { resolveSessionPath } from '../vault/index.js';
import * as http from 'http';
import * as path from 'path';

export class RESTAdapter extends BaseAdapter {
  private server: http.Server | null = null;
  private rateLimiter = new RateLimiter(60, 60000);
  private lockoutManager?: LockoutManager;

  constructor(config: EnvCPConfig, projectPath: string, password?: string, vaultPath?: string, sessionPath?: string) {
    super(config, projectPath, password, vaultPath, sessionPath);
    
    // If password is provided (vault already unlocked), clear any API key lockout
    if (password) {
      this.clearApiKeyLockout().catch(() => {
        // Silently ignore errors
      });
    }
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


async startServer(port: number, host: string, apiKey?: string, rateLimitConfig?: RateLimitConfig): Promise<void> {
  await this.init();

  const rateLimitEnabled = rateLimitConfig?.enabled !== false;
  if (rateLimitEnabled) {
    this.rateLimiter?.destroy();
    this.rateLimiter = new RateLimiter(rateLimitConfig?.requests_per_minute ?? 60, 60000);
  }
  const whitelist = rateLimitConfig?.whitelist ?? [];

  // Initialize lockout manager for API key authentication failures
  const bfpConfig = this.config.security?.brute_force_protection;
  if (bfpConfig && bfpConfig.enabled !== false) {
    const sessionDir = path.dirname(resolveSessionPath(this.projectPath, this.config));
    const lockoutPath = path.join(sessionDir, '.lockout-api');
    
    this.lockoutManager = new LockoutManager(lockoutPath);
  }

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

      // API key validation with lockout protection
      if (apiKey) {
        // Check lockout first if enabled
        if (this.lockoutManager) {
          const lockoutStatus = await this.lockoutManager.check();
          if (lockoutStatus.locked) {
            if (lockoutStatus.permanent_locked) {
              await this.logs.log({ timestamp: new Date().toISOString(), operation: 'auth_failure', variable: '', source: 'api', success: false, message: `API authentication blocked - permanent lockout from ${req.socket.remoteAddress ?? 'unknown'}` });
              sendJson(res, 403, this.createResponse(false, undefined, 'Authentication permanently locked - recovery required'));
              return;
            } else {
              await this.logs.log({ timestamp: new Date().toISOString(), operation: 'auth_failure', variable: '', source: 'api', success: false, message: `API authentication blocked - lockout for ${lockoutStatus.remaining_seconds}s from ${req.socket.remoteAddress ?? 'unknown'}` });
              res.setHeader('Retry-After', lockoutStatus.remaining_seconds.toString());
              sendJson(res, 429, this.createResponse(false, undefined, `Too many failed attempts - try again in ${lockoutStatus.remaining_seconds} seconds`));
              return;
            }
          }
          
          // Set notification source for this request
          const ip = req.socket.remoteAddress || 'unknown';
          const userAgent = req.headers['user-agent'] || 'unknown';
          this.lockoutManager.setNotificationSource('api', ip, userAgent);
        }
        
        const providedKey = (req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '')) as string | undefined;
        if (!validateApiKey(providedKey, apiKey)) {
          // Record failed attempt if lockout is enabled
          if (this.lockoutManager) {
            const bfpConfig = this.config.security?.brute_force_protection;
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
              permanentThreshold
            );

            if (status.locked) {
              const message = status.permanent_locked
                ? 'Authentication permanently locked - recovery required'
                : `Too many failed attempts - try again in ${status.remaining_seconds} seconds`;

              const statusCode = status.permanent_locked ? 403 : 429;
              if (!status.permanent_locked) {
                res.setHeader('Retry-After', status.remaining_seconds.toString());
              }

              await this.logs.log({ timestamp: new Date().toISOString(), operation: 'auth_failure', variable: '', source: 'api', success: false, message: `Invalid API key - ${status.permanent_locked ? 'permanent lockout' : `lockout for ${status.remaining_seconds}s`} from ${req.socket.remoteAddress ?? 'unknown'}` });
              sendJson(res, statusCode, this.createResponse(false, undefined, message));
              return;
            }
          }

          await this.logs.log({ timestamp: new Date().toISOString(), operation: 'auth_failure', variable: '', source: 'api', success: false, message: `Invalid API key from ${req.socket.remoteAddress ?? 'unknown'}` });
          sendJson(res, 401, this.createResponse(false, undefined, 'Invalid API key'));
          return;
        }
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;
      const segments = pathname.split('/').filter(Boolean);

      const clientIdHeader = req.headers['x-envcp-client-id'];
      const clientId = (Array.isArray(clientIdHeader) ? clientIdHeader[0] : clientIdHeader) || 'api';

      try {
        // Routes:
        // GET  /api/variables         - List variables
        // GET  /api/variables/:name   - Get variable
        // POST /api/variables         - Create variable
        // PUT  /api/variables/:name   - Update variable
        // DELETE /api/variables/:name - Delete variable
        // POST /api/sync              - Sync to .env
        // POST /api/run               - Run command
        // GET  /api/tools             - List available tools
        // POST /api/tools/:name       - Call a tool

        if (segments[0] === 'api') {
          const resource = segments[1];

          // Health check
          if (pathname === '/api/health' || pathname === '/api') {
            sendJson(res, 200, this.createResponse(true, {
              status: 'ok',
              version: VERSION,
              mode: 'rest',
            }));
            return;
          }

          // List tools
          if (resource === 'tools' && !segments[2] && req.method === 'GET') {
            const tools = this.getToolDefinitions().map(t => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            }));
            sendJson(res, 200, this.createResponse(true, { tools }));
            return;
          }

          // Call tool
          if (resource === 'tools' && segments[2] && req.method === 'POST') {
            const toolName = segments[2];
            const body = await parseBody(req);
            const result = await this.callTool(toolName, body, clientId);
            sendJson(res, 200, this.createResponse(true, result));
            return;
          }

          // Variables
          if (resource === 'variables') {
            const varName = segments[2];

            if (!varName && req.method === 'GET') {
              const tagsParam = parsedUrl.searchParams.getAll('tags');
              const tags = tagsParam.length > 0 ? tagsParam : undefined;
              const result = await this.callTool('envcp_list', { tags }, clientId);
              sendJson(res, 200, this.createResponse(true, result));
              return;
            }

            if (!varName && req.method === 'POST') {
              const body = await parseBody(req);
              const result = await this.callTool('envcp_set', body, clientId);
              sendJson(res, 201, this.createResponse(true, result));
              return;
            }

            if (varName && req.method === 'GET') {
              const showValue = parsedUrl.searchParams.get('show_value') === 'true';
              const result = await this.callTool('envcp_get', { name: varName, show_value: showValue }, clientId);
              sendJson(res, 200, this.createResponse(true, result));
              return;
            }

            if (varName && req.method === 'PUT') {
              const body = await parseBody(req);
              const result = await this.callTool('envcp_set', { ...body, name: varName }, clientId);
              sendJson(res, 200, this.createResponse(true, result));
              return;
            }

            if (varName && req.method === 'DELETE') {
              const result = await this.callTool('envcp_delete', { name: varName }, clientId);
              sendJson(res, 200, this.createResponse(true, result));
              return;
            }
          }

          // Sync
          if (resource === 'sync' && req.method === 'POST') {
            const result = await this.callTool('envcp_sync', {}, clientId);
            sendJson(res, 200, this.createResponse(true, result));
            return;
          }

          // Run
          if (resource === 'run' && req.method === 'POST') {
            const body = await parseBody(req);
            const result = await this.callTool('envcp_run', body, clientId);
            sendJson(res, 200, this.createResponse(true, result));
            return;
          }

          // Check access
          if (resource === 'access' && segments[2] && req.method === 'GET') {
            const result = await this.callTool('envcp_check_access', { name: segments[2] }, clientId);
            sendJson(res, 200, this.createResponse(true, result));
            return;
          }
        }

        // 404
        sendJson(res, 404, this.createResponse(false, undefined, 'Not found'));

      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes('locked') ? 401 :
                       message.includes('not found') ? 404 :
                       message.includes('disabled') ? 403 : 500;
        sendJson(res, status, this.createResponse(false, undefined, message));
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
