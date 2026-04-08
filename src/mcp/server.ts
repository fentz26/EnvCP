import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { StorageManager, LogManager } from '../storage/index.js';
import { EnvCPConfig, Variable } from '../types.js';
import { maskValue } from '../utils/crypto.js';
import { canAccess, isBlacklisted, canAIActiveCheck, requiresUserReference } from '../config/manager.js';
import { SessionManager } from '../utils/session.js';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';

export class EnvCPServer {
  private server: Server;
  private storage: StorageManager;
  private logs: LogManager;
  private sessionManager: SessionManager;
  private config: EnvCPConfig;
  private projectPath: string;

  constructor(config: EnvCPConfig, projectPath: string, password?: string) {
    this.config = config;
    this.projectPath = projectPath;
    this.storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );
    
    this.sessionManager = new SessionManager(
      path.join(projectPath, config.session?.path || '.envcp/.session'),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );
    
    if (password) {
      this.storage.setPassword(password);
    }
    
    this.logs = new LogManager(path.join(projectPath, '.envcp', 'logs'));
    
    this.server = new Server(
      { name: 'envcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'envcp_list',
          description: 'List all available environment variable names. Values are never shown to AI. Only available if allow_ai_active_check is enabled.',
          inputSchema: {
            type: 'object',
            properties: {
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags',
              },
            },
          },
        },
        {
          name: 'envcp_get',
          description: 'Get an environment variable. Returns masked value by default. Use show_value=true to see the actual value (requires user confirmation).',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Variable name',
              },
              show_value: {
                type: 'boolean',
                description: 'Show actual value (default: false, returns masked value)',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'envcp_set',
          description: 'Create or update an environment variable. Only available if allow_ai_write is enabled.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Variable name',
              },
              value: {
                type: 'string',
                description: 'Variable value',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for organization',
              },
              description: {
                type: 'string',
                description: 'Variable description',
              },
            },
            required: ['name', 'value'],
          },
        },
        {
          name: 'envcp_delete',
          description: 'Delete an environment variable. Only available if allow_ai_delete is enabled.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Variable name',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'envcp_sync',
          description: 'Sync variables to .env file. Only available if sync is enabled.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'envcp_run',
          description: 'Execute a command with environment variables injected. Variables are loaded but not shown.',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Command to execute',
              },
              variables: {
                type: 'array',
                items: { type: 'string' },
                description: 'Variable names to inject',
              },
            },
            required: ['command', 'variables'],
          },
        },
        {
          name: 'envcp_add_to_env',
          description: 'Add variable reference to .env file without showing the actual value.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Variable name to add',
              },
              env_file: {
                type: 'string',
                description: 'Path to .env file (default: .env)',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'envcp_check_access',
          description: 'Check if a variable exists and can be accessed. Returns yes/no, not the value.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Variable name to check',
              },
            },
            required: ['name'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        await this.ensurePassword();
        
        switch (name) {
          case 'envcp_list':
            return await this.handleList(args as any);
          case 'envcp_get':
            return await this.handleGet(args as any);
          case 'envcp_set':
            return await this.handleSet(args as any);
          case 'envcp_delete':
            return await this.handleDelete(args as any);
          case 'envcp_sync':
            return await this.handleSync();
          case 'envcp_run':
            return await this.handleRun(args as any);
          case 'envcp_add_to_env':
            return await this.handleAddToEnv(args as any);
          case 'envcp_check_access':
            return await this.handleCheckAccess(args as any);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, error.message);
      }
    });
  }

  private async ensurePassword(): Promise<void> {
    const pwd = this.sessionManager.getPassword();
    if (pwd && await this.sessionManager.isValid()) {
      this.storage.setPassword(pwd);
      return;
    }
    
    throw new Error('Session locked. Please unlock first using: envcp unlock');
  }

  private async handleList(args: { tags?: string[] }): Promise<any> {
    if (!canAIActiveCheck(this.config)) {
      throw new Error('AI active check is disabled. User must explicitly mention variable names.');
    }

    const names = await this.storage.list();
    let filtered = names.filter(n => canAccess(n, this.config) && !isBlacklisted(n, this.config));
    
    if (args.tags && args.tags.length > 0) {
      const variables = await this.storage.load();
      filtered = filtered.filter(name => {
        const v = variables[name];
        return v.tags && args.tags!.some(t => v.tags!.includes(t));
      });
    }

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'list',
      source: 'mcp',
      success: true,
      message: `Listed ${filtered.length} variables`,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ variables: filtered, count: filtered.length }, null, 2),
        },
      ],
    };
  }

  private async handleGet(args: { name: string; show_value?: boolean }): Promise<any> {
    const variable = await this.storage.get(args.name);
    
    if (!variable) {
      throw new Error(`Variable '${args.name}' not found`);
    }

    if (isBlacklisted(args.name, this.config)) {
      throw new Error(`Variable '${args.name}' is blacklisted and cannot be accessed`);
    }

    if (!canAccess(args.name, this.config)) {
      throw new Error(`Access denied to variable '${args.name}'`);
    }

    variable.accessed = new Date().toISOString();
    await this.storage.set(args.name, variable);

    const value = args.show_value && !this.config.access.mask_values
      ? variable.value
      : maskValue(variable.value);

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'get',
      variable: args.name,
      source: 'mcp',
      success: true,
      message: args.show_value ? 'Value revealed' : 'Value masked',
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: variable.name,
            value: value,
            tags: variable.tags,
            description: variable.description,
            encrypted: variable.encrypted,
          }, null, 2),
        },
      ],
    };
  }

  private async handleSet(args: { name: string; value: string; tags?: string[]; description?: string }): Promise<any> {
    if (!this.config.access.allow_ai_write) {
      throw new Error('AI write access is disabled');
    }

    if (isBlacklisted(args.name, this.config)) {
      throw new Error(`Variable '${args.name}' is blacklisted`);
    }

    const existing = await this.storage.get(args.name);
    const now = new Date().toISOString();
    
    const variable: Variable = {
      name: args.name,
      value: args.value,
      encrypted: this.config.storage.encrypted,
      tags: args.tags,
      description: args.description,
      created: existing?.created || now,
      updated: now,
      sync_to_env: true,
    };

    await this.storage.set(args.name, variable);

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: existing ? 'update' : 'add',
      variable: args.name,
      source: 'mcp',
      success: true,
      message: `Variable ${existing ? 'updated' : 'created'}`,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, message: `Variable '${args.name}' ${existing ? 'updated' : 'created'}` }),
        },
      ],
    };
  }

  private async handleDelete(args: { name: string }): Promise<any> {
    if (!this.config.access.allow_ai_delete) {
      throw new Error('AI delete access is disabled');
    }

    const deleted = await this.storage.delete(args.name);

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'delete',
      variable: args.name,
      source: 'mcp',
      success: deleted,
      message: deleted ? 'Variable deleted' : 'Variable not found',
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: deleted, message: deleted ? `Variable '${args.name}' deleted` : `Variable '${args.name}' not found` }),
        },
      ],
    };
  }

  private async handleSync(): Promise<any> {
    if (!this.config.sync.enabled) {
      throw new Error('Sync is disabled in configuration');
    }

    const variables = await this.storage.load();
    const lines: string[] = [];
    
    if (this.config.sync.header) {
      lines.push(this.config.sync.header);
    }

    for (const [name, variable] of Object.entries(variables)) {
      if (isBlacklisted(name, this.config)) {
        continue;
      }

      const excluded = this.config.sync.exclude?.some(pattern => {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(name);
      });

      if (excluded || !variable.sync_to_env) {
        continue;
      }

      lines.push(`${name}=${variable.value}`);
    }

    const envPath = path.join(this.projectPath, this.config.sync.target);
    await fs.writeFile(envPath, lines.join('\n'), 'utf8');

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'sync',
      source: 'mcp',
      success: true,
      message: `Synced ${lines.length} variables to ${this.config.sync.target}`,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, message: `Synced ${lines.length} variables to ${this.config.sync.target}` }),
        },
      ],
    };
  }

  private parseCommand(command: string): { program: string; args: string[] } {
    const tokens: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < command.length; i++) {
      const ch = command[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if (ch === ' ' && !inSingle && !inDouble) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current.length > 0) tokens.push(current);

    if (tokens.length === 0) throw new Error('Empty command');
    return { program: tokens[0], args: tokens.slice(1) };
  }

  private validateCommand(command: string): void {
    const shellMetachars = /[;&|`$(){}!><\n\\]/;
    if (shellMetachars.test(command)) {
      throw new Error('Command contains disallowed shell metacharacters: ; & | ` $ ( ) { } ! > < \\');
    }
  }

  private async handleRun(args: { command: string; variables: string[] }): Promise<any> {
    this.validateCommand(args.command);

    const { spawn } = await import('child_process');
    const { program, args: cmdArgs } = this.parseCommand(args.command);
    const env: Record<string, string> = { ...process.env };

    for (const name of args.variables) {
      if (isBlacklisted(name, this.config)) {
        continue;
      }
      const variable = await this.storage.get(name);
      if (variable) {
        env[name] = variable.value;
      }
    }

    return new Promise((resolve) => {
      const proc = spawn(program, cmdArgs, {
        env,
        cwd: this.projectPath,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                exitCode: code,
                stdout,
                stderr,
              }, null, 2),
            },
          ],
        });
      });
    });
  }

  private async handleAddToEnv(args: { name: string; env_file?: string }): Promise<any> {
    const variable = await this.storage.get(args.name);
    
    if (!variable) {
      throw new Error(`Variable '${args.name}' not found`);
    }

    if (isBlacklisted(args.name, this.config)) {
      throw new Error(`Variable '${args.name}' is blacklisted`);
    }

    const envPath = path.join(this.projectPath, args.env_file || '.env');
    let content = '';

    if (await fs.pathExists(envPath)) {
      content = await fs.readFile(envPath, 'utf8');
    }

    const envVars = dotenv.parse(content);
    
    if (envVars[args.name]) {
      const lines = content.split('\n');
      const newLines = lines.map(line => {
        if (line.startsWith(`${args.name}=`)) {
          return `${args.name}=${variable.value}`;
        }
        return line;
      });
      content = newLines.join('\n');
    } else {
      content += `\n${args.name}=${variable.value}`;
    }

    await fs.writeFile(envPath, content, 'utf8');

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'add',
      variable: args.name,
      source: 'mcp',
      success: true,
      message: `Added to ${args.env_file || '.env'}`,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, message: `Variable '${args.name}' added to ${args.env_file || '.env'}` }),
        },
      ],
    };
  }

  private async handleCheckAccess(args: { name: string }): Promise<any> {
    const variable = await this.storage.get(args.name);
    const exists = !!variable;
    const blacklisted = isBlacklisted(args.name, this.config);
    const accessible = exists && !blacklisted && canAccess(args.name, this.config);

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'check_access',
      variable: args.name,
      source: 'mcp',
      success: true,
      message: `Access check: ${accessible ? 'granted' : 'denied'}`,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: args.name,
            exists,
            accessible,
            blacklisted,
            message: accessible ? 'Variable exists and can be accessed' : 'Variable cannot be accessed or does not exist',
          }, null, 2),
        },
      ],
    };
  }

  async start(): Promise<void> {
    await this.logs.init();
    await this.sessionManager.init();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
