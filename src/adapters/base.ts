import { StorageManager, LogManager } from '../storage/index.js';
import { EnvCPConfig, Variable, ToolDefinition } from '../types.js';
import { maskValue } from '../utils/crypto.js';
import { canAccess, isBlacklisted, canAIActiveCheck, requiresUserReference, validateVariableName } from '../config/manager.js';
import { SessionManager } from '../utils/session.js';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';

export abstract class BaseAdapter {
  protected storage: StorageManager;
  protected logs: LogManager;
  protected sessionManager: SessionManager;
  protected config: EnvCPConfig;
  protected projectPath: string;
  protected tools: Map<string, ToolDefinition>;

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
    this.tools = new Map();
    this.registerTools();
  }

  protected abstract registerTools(): void;

  async init(): Promise<void> {
    await this.logs.init();
    await this.sessionManager.init();
  }

  protected async ensurePassword(): Promise<void> {
    const pwd = this.sessionManager.getPassword();
    if (pwd && await this.sessionManager.isValid()) {
      this.storage.setPassword(pwd);
      return;
    }
    throw new Error('Session locked. Please unlock first using: envcp unlock');
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    await this.ensurePassword();
    return tool.handler(params);
  }

  // Shared tool implementations
  protected async listVariables(args: { tags?: string[] }): Promise<{ variables: string[]; count: number }> {
    if (!this.config.access.allow_ai_read) {
      throw new Error('AI read access is disabled');
    }

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
      source: 'api',
      success: true,
      message: `Listed ${filtered.length} variables`,
    });

    return { variables: filtered, count: filtered.length };
  }

  protected async getVariable(args: { name: string; show_value?: boolean }): Promise<{
    name: string;
    value: string;
    tags?: string[];
    description?: string;
    encrypted: boolean;
  }> {
    if (!this.config.access.allow_ai_read) {
      throw new Error('AI read access is disabled');
    }

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

    const canReveal = args.show_value && !this.config.access.mask_values && !this.config.access.require_confirmation;
    const value = canReveal ? variable.value : maskValue(variable.value);

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'get',
      variable: args.name,
      source: 'api',
      success: true,
      message: canReveal ? 'Value revealed' : 'Value masked',
    });

    return {
      name: variable.name,
      value: value,
      tags: variable.tags,
      description: variable.description,
      encrypted: variable.encrypted,
    };
  }

  protected async setVariable(args: {
    name: string;
    value: string;
    tags?: string[];
    description?: string;
  }): Promise<{ success: boolean; message: string }> {
    if (!this.config.access.allow_ai_write) {
      throw new Error('AI write access is disabled');
    }

    if (!validateVariableName(args.name)) {
      throw new Error(`Invalid variable name '${args.name}'. Must match [A-Za-z_][A-Za-z0-9_]*`);
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
      source: 'api',
      success: true,
      message: `Variable ${existing ? 'updated' : 'created'}`,
    });

    return { success: true, message: `Variable '${args.name}' ${existing ? 'updated' : 'created'}` };
  }

  protected async deleteVariable(args: { name: string }): Promise<{ success: boolean; message: string }> {
    if (!this.config.access.allow_ai_delete) {
      throw new Error('AI delete access is disabled');
    }

    const deleted = await this.storage.delete(args.name);

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'delete',
      variable: args.name,
      source: 'api',
      success: deleted,
      message: deleted ? 'Variable deleted' : 'Variable not found',
    });

    return {
      success: deleted,
      message: deleted ? `Variable '${args.name}' deleted` : `Variable '${args.name}' not found`
    };
  }

  protected async syncToEnv(): Promise<{ success: boolean; message: string }> {
    if (!this.config.access.allow_ai_export) {
      throw new Error('AI export access is disabled');
    }

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

      const needsQuoting = /[\s#"'\\]/.test(variable.value);
      const val = needsQuoting ? `"${variable.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : variable.value;
      lines.push(`${name}=${val}`);
    }

    const envPath = path.join(this.projectPath, this.config.sync.target);
    await fs.writeFile(envPath, lines.join('\n'), 'utf8');

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'sync',
      source: 'api',
      success: true,
      message: `Synced ${lines.length} variables to ${this.config.sync.target}`,
    });

    return { success: true, message: `Synced ${lines.length} variables to ${this.config.sync.target}` };
  }

  protected async addToEnv(args: { name: string; env_file?: string }): Promise<{ success: boolean; message: string }> {
    const variable = await this.storage.get(args.name);

    if (!variable) {
      throw new Error(`Variable '${args.name}' not found`);
    }

    if (isBlacklisted(args.name, this.config)) {
      throw new Error(`Variable '${args.name}' is blacklisted`);
    }

    const envPath = path.resolve(this.projectPath, args.env_file || '.env');
    if (!envPath.startsWith(path.resolve(this.projectPath))) {
      throw new Error('env_file must be within the project directory');
    }

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
      source: 'api',
      success: true,
      message: `Added to ${args.env_file || '.env'}`,
    });

    return { success: true, message: `Variable '${args.name}' added to ${args.env_file || '.env'}` };
  }

  protected async checkAccess(args: { name: string }): Promise<{
    name: string;
    exists: boolean;
    accessible: boolean;
    blacklisted: boolean;
    message: string;
  }> {
    const variable = await this.storage.get(args.name);
    const exists = !!variable;
    const blacklisted = isBlacklisted(args.name, this.config);
    const accessible = exists && !blacklisted && canAccess(args.name, this.config);

    await this.logs.log({
      timestamp: new Date().toISOString(),
      operation: 'check_access',
      variable: args.name,
      source: 'api',
      success: true,
      message: `Access check: ${accessible ? 'granted' : 'denied'}`,
    });

    return {
      name: args.name,
      accessible,
      message: accessible ? 'Variable exists and can be accessed' : 'Variable cannot be accessed',
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

  protected async runCommand(args: { command: string; variables: string[] }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }> {
    this.validateCommand(args.command);

    const { spawn } = await import('child_process');
    const { program, args: cmdArgs } = this.parseCommand(args.command);
    const env: Record<string, string> = { ...process.env } as Record<string, string>;

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
        resolve({ exitCode: code, stdout, stderr });
      });
    });
  }
}
