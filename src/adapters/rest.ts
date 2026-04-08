import { BaseAdapter } from './base.js';
import { EnvCPConfig, RESTResponse, ToolDefinition } from '../types.js';
import * as http from 'http';
import * as url from 'url';

export class RESTAdapter extends BaseAdapter {
  private server: http.Server | null = null;

  constructor(config: EnvCPConfig, projectPath: string, password?: string) {
    super(config, projectPath, password);
  }

  protected registerTools(): void {
    const tools: ToolDefinition[] = [
      {
        name: 'list',
        description: 'List all available environment variable names',
        parameters: {
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        },
        handler: async (params) => this.listVariables(params as { tags?: string[] }),
      },
      {
        name: 'get',
        description: 'Get an environment variable',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
          show_value: { type: 'boolean', description: 'Show actual value' },
        },
        handler: async (params) => this.getVariable(params as { name: string; show_value?: boolean }),
      },
      {
        name: 'set',
        description: 'Create or update an environment variable',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
          value: { type: 'string', required: true, description: 'Variable value' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
          description: { type: 'string', description: 'Description' },
        },
        handler: async (params) => this.setVariable(params as any),
      },
      {
        name: 'delete',
        description: 'Delete an environment variable',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
        },
        handler: async (params) => this.deleteVariable(params as { name: string }),
      },
      {
        name: 'sync',
        description: 'Sync variables to .env file',
        parameters: {},
        handler: async () => this.syncToEnv(),
      },
      {
        name: 'add_to_env',
        description: 'Add variable to .env file',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
          env_file: { type: 'string', description: 'Path to .env file' },
        },
        handler: async (params) => this.addToEnv(params as { name: string; env_file?: string }),
      },
      {
        name: 'check_access',
        description: 'Check if a variable can be accessed',
        parameters: {
          name: { type: 'string', required: true, description: 'Variable name' },
        },
        handler: async (params) => this.checkAccess(params as { name: string }),
      },
      {
        name: 'run',
        description: 'Execute a command with environment variables',
        parameters: {
          command: { type: 'string', required: true, description: 'Command to execute' },
          variables: { type: 'array', items: { type: 'string' }, required: true, description: 'Variables to inject' },
        },
        handler: async (params) => this.runCommand(params as { command: string; variables: string[] }),
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

  private parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  async startServer(port: number, host: string, apiKey?: string): Promise<void> {
    await this.init();

    this.server = http.createServer(async (req, res) => {
      this.setCorsHeaders(res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // API key validation
      if (apiKey) {
        const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        if (providedKey !== apiKey) {
          this.sendJson(res, 401, this.createResponse(false, undefined, 'Invalid API key'));
          return;
        }
      }

      const parsedUrl = url.parse(req.url || '/', true);
      const pathname = parsedUrl.pathname || '/';
      const segments = pathname.split('/').filter(Boolean);

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
            this.sendJson(res, 200, this.createResponse(true, {
              status: 'ok',
              version: '1.0.0',
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
            this.sendJson(res, 200, this.createResponse(true, { tools }));
            return;
          }

          // Call tool
          if (resource === 'tools' && segments[2] && req.method === 'POST') {
            const toolName = segments[2];
            const body = await this.parseBody(req);
            const result = await this.callTool(toolName, body);
            this.sendJson(res, 200, this.createResponse(true, result));
            return;
          }

          // Variables
          if (resource === 'variables') {
            const varName = segments[2];

            if (!varName && req.method === 'GET') {
              const tags = parsedUrl.query.tags
                ? (Array.isArray(parsedUrl.query.tags) ? parsedUrl.query.tags : [parsedUrl.query.tags])
                : undefined;
              const result = await this.callTool('list', { tags });
              this.sendJson(res, 200, this.createResponse(true, result));
              return;
            }

            if (!varName && req.method === 'POST') {
              const body = await this.parseBody(req);
              const result = await this.callTool('set', body);
              this.sendJson(res, 201, this.createResponse(true, result));
              return;
            }

            if (varName && req.method === 'GET') {
              const showValue = parsedUrl.query.show_value === 'true';
              const result = await this.callTool('get', { name: varName, show_value: showValue });
              this.sendJson(res, 200, this.createResponse(true, result));
              return;
            }

            if (varName && req.method === 'PUT') {
              const body = await this.parseBody(req);
              const result = await this.callTool('set', { ...body, name: varName });
              this.sendJson(res, 200, this.createResponse(true, result));
              return;
            }

            if (varName && req.method === 'DELETE') {
              const result = await this.callTool('delete', { name: varName });
              this.sendJson(res, 200, this.createResponse(true, result));
              return;
            }
          }

          // Sync
          if (resource === 'sync' && req.method === 'POST') {
            const result = await this.callTool('sync', {});
            this.sendJson(res, 200, this.createResponse(true, result));
            return;
          }

          // Run
          if (resource === 'run' && req.method === 'POST') {
            const body = await this.parseBody(req);
            const result = await this.callTool('run', body);
            this.sendJson(res, 200, this.createResponse(true, result));
            return;
          }

          // Check access
          if (resource === 'access' && segments[2] && req.method === 'GET') {
            const result = await this.callTool('check_access', { name: segments[2] });
            this.sendJson(res, 200, this.createResponse(true, result));
            return;
          }
        }

        // 404
        this.sendJson(res, 404, this.createResponse(false, undefined, 'Not found'));

      } catch (error: any) {
        const status = error.message.includes('locked') ? 401 :
                       error.message.includes('not found') ? 404 :
                       error.message.includes('disabled') ? 403 : 500;
        this.sendJson(res, status, this.createResponse(false, undefined, error.message));
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
