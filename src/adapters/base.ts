import { StorageManager, LogManager, resolveLogPath } from '../storage/index.js';
import { EnvCPConfig, Variable, ToolDefinition, LogsRole, RateLimitConfig } from '../types.js';
import { maskValue, hashVariablePassword, verifyVariablePassword, encryptVariableValue, decryptVariableValue, scrubOutput } from '../utils/crypto.js';
import { canAccessVariable, isBlacklisted, canAIActiveCheck, validateVariableName, requiresConfirmationForVariable, matchesPattern, getDefaultAccessFlag, resolveAccessRuleFlag } from '../config/manager.js';
import { SessionManager } from '../utils/session.js';
import { resolveSessionPath } from '../vault/index.js';
import { setCorsHeaders, sendJson, validateApiKey, RateLimiter, rateLimitMiddleware } from '../utils/http.js';
import * as fs from 'node:fs/promises';
import { pathExists, parseEnv } from '../utils/fs.js';
import * as path from 'node:path';
import * as http from 'node:http';

export abstract class BaseAdapter {
  protected storage: StorageManager;
  protected logs: LogManager;
  protected sessionManager: SessionManager;
  protected config: EnvCPConfig;
  protected projectPath: string;
  protected tools: Map<string, ToolDefinition>;

  constructor(config: EnvCPConfig, projectPath: string, password?: string, vaultPath?: string, sessionPath?: string) {
    this.config = config;
    this.projectPath = projectPath;

    const encrypted = config.encryption?.enabled !== false && config.storage.encrypted;
    const storePath = vaultPath || path.join(projectPath, config.storage.path);
    this.storage = new StorageManager(storePath, encrypted);

    this.sessionManager = new SessionManager(
      sessionPath || resolveSessionPath(projectPath, config),
      config.session.timeout_minutes,
      config.session.max_extensions
    );

    if (password) {
      this.storage.setPassword(password);
    }

    this.logs = new LogManager(resolveLogPath(config.audit, projectPath), config.audit);
    this.tools = new Map();
    this.registerTools();
  }

  protected registerTools(): void {
    this.registerDefaultTools();
  }

  protected registerDefaultTools(): void {
    const tools: ToolDefinition[] = [
      {
        name: 'envcp_list',
        description: 'List all available environment variable names. Values are never shown.',
        parameters: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
          },
        },
        handler: async (params) => this.listVariables(params as { tags?: string[] }),
      },
      {
        name: 'envcp_get',
        description: 'Get an environment variable. Returns masked value by default. Protected variables require variable_password.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
            show_value: { type: 'boolean', description: 'Show actual value (requires user confirmation)' },
            variable_password: { type: 'string', description: 'Password for protected variables' },
          },
          required: ['name'],
        },
        handler: async (params) => this.getVariable(params as { name: string; show_value?: boolean; variable_password?: string }),
      },
      {
        name: 'envcp_set',
        description: 'Create or update an environment variable. Use protect=true with variable_password to add per-variable protection.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
            value: { type: 'string', description: 'Variable value' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
            description: { type: 'string', description: 'Description' },
            protect: { type: 'boolean', description: 'Enable per-variable password protection' },
            unprotect: { type: 'boolean', description: 'Remove per-variable password protection' },
            variable_password: { type: 'string', description: 'Password for per-variable protection' },
          },
          required: ['name', 'value'],
        },
        handler: async (params) => this.setVariable(params as { name: string; value: string; tags?: string[]; description?: string; protect?: boolean; unprotect?: boolean; variable_password?: string }),
      },
      {
        name: 'envcp_delete',
        description: 'Delete an environment variable.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
          },
          required: ['name'],
        },
        handler: async (params) => this.deleteVariable(params as { name: string }),
      },
      {
        name: 'envcp_sync',
        description: 'Sync variables to .env file.',
        parameters: { type: 'object', properties: {} },
        handler: async () => this.syncToEnv(),
      },
      {
        name: 'envcp_run',
        description: 'Execute a command with environment variables injected.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            variables: { type: 'array', items: { type: 'string' }, description: 'Variables to inject' },
          },
          required: ['command', 'variables'],
        },
        handler: async (params) => this.runCommand(params as { command: string; variables: string[] }),
      },
      {
        name: 'envcp_add_to_env',
        description: 'Write a stored variable to a .env file.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name to add' },
            env_file: { type: 'string', description: 'Path to .env file (default: .env)' },
          },
          required: ['name'],
        },
        handler: async (params) => this.addToEnv(params as { name: string; env_file?: string }),
      },
      {
        name: 'envcp_check_access',
        description: 'Check if a variable exists and can be accessed.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name to check' },
          },
          required: ['name'],
        },
        handler: async (params) => this.checkAccess(params as { name: string }),
      },
      {
        name: 'envcp_logs',
        description: 'Read filtered audit log entries (requires access.allow_ai_logs: true). Log entries contain operation metadata only — variable values are never logged.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Log date (YYYY-MM-DD, default: today)' },
            operation: { type: 'string', description: 'Filter by operation (add, get, update, delete, list, sync, export, unlock, lock, check_access, run, auth_failure, etc.)' },
            variable: { type: 'string', description: 'Filter by variable name' },
            source: { type: 'string', enum: ['cli', 'mcp', 'api'], description: 'Filter by source' },
            success: { type: 'boolean', description: 'Filter by success (true) or failure (false)' },
            tail: { type: 'number', description: 'Return only the last N entries (max 100)' },
          },
        },
        handler: async (params) => this.readLogs(params as {
          date?: string; operation?: string; variable?: string; source?: string; success?: boolean; tail?: number;
        }),
      },
    ];

    tools.forEach(tool => this.tools.set(tool.name, tool));
  }

  protected async readLogs(args: {
    date?: string; operation?: string; variable?: string; source?: string; success?: boolean; tail?: number;
  }): Promise<{ entries: import('../types.js').OperationLog[]; count: number; role: LogsRole }> {
    if (!this.config.access.allow_ai_logs) {
      throw new Error('AI log access is disabled (set access.allow_ai_logs: true in envcp.yaml)');
    }

    const role = this.resolveLogsRole(this.currentClientId);
    if (role === 'none') {
      throw new Error(`Logs access denied for client "${this.currentClientId || '(unidentified)'}" (role: none)`);
    }

    const MAX_TAIL = 100;
    const tail = args.tail === undefined ? MAX_TAIL : Math.min(Math.max(1, Math.floor(args.tail)), MAX_TAIL);

    const filter: import('../storage/index.js').LogFilter = { tail };
    if (args.date) filter.date = args.date;
    if (args.operation) filter.operation = args.operation;
    if (args.variable) filter.variable = args.variable;
    if (args.source) filter.source = args.source;
    if (args.success !== undefined) filter.success = args.success;

    let entries = await this.logs.getLogs(filter);
    if (role === 'own_sessions') {
      entries = entries.filter((e) => e.client_id === this.currentClientId);
    }
    return { entries, count: entries.length, role };
  }

  async init(): Promise<void> {
    await this.logs.init();
    await this.sessionManager.init();
  }

  protected async ensurePassword(): Promise<void> {
    // Passwordless mode: no session or password needed
    if (this.config.encryption?.enabled === false) return;

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

  protected getStructuredToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  }> {
    return this.getToolDefinitions().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: (tool.parameters['properties'] as Record<string, unknown>) ?? {},
        required: tool.parameters['required'] as string[] | undefined,
      },
    }));
  }

  protected currentClientId = '';

  async callTool(name: string, params: Record<string, unknown>, clientId = ''): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    await this.ensurePassword();
    const previousClientId = this.currentClientId;
    this.currentClientId = clientId;
    try {
      return await tool.handler(params);
    } finally {
      this.currentClientId = previousClientId;
    }
  }

  protected resolveLogsRole(clientId: string): LogsRole {
    /* c8 ignore next -- Zod always provides logs_roles default; || fallback unreachable */
    const roles = this.config.access.logs_roles || {};
    /* c8 ignore next */
    if (clientId && Object.hasOwn(roles, clientId)) {
      return roles[clientId];
    }
    /* c8 ignore next -- Zod always provides logs_default_role; ?? fallback unreachable */
    return this.config.access.logs_default_role ?? 'own_sessions';
  }

  protected async logEvent(entry: import('../types.js').OperationLog): Promise<void> {
    await this.logs.log({
      ...entry,
      client_id: entry.client_id || this.currentClientId || '',
    });
  }

  // Shared tool implementations
  protected async listVariables(args: { tags?: string[] }): Promise<{ variables: Array<string | { name: string; protected: boolean }>; count: number }> {
    if (!canAIActiveCheck(this.config, this.currentClientId)) {
      throw new Error('AI active check is disabled. User must explicitly mention variable names.');
    }

    const names = await this.storage.list();
    let filtered = names.filter(n => canAccessVariable(n, this.config, 'read', this.currentClientId));

    if (filtered.length === 0 && !getDefaultAccessFlag(this.config, 'read', this.currentClientId)) {
      throw new Error('AI read access is disabled');
    }

    const allVars = await this.storage.load();

    if (args.tags && args.tags.length > 0) {
      filtered = filtered.filter(name => {
        const v = allVars[name];
        return v.tags && args.tags!.some(t => v.tags!.includes(t));
      });
    }

    const hasAnyProtected = filtered.some(name => allVars[name]?.protected);

    await this.logEvent({
      timestamp: new Date().toISOString(),
      operation: 'list',
      source: 'api',
      success: true,
      message: `Listed ${filtered.length} variables`,
    });

    if (hasAnyProtected) {
      return {
        variables: filtered.map(name => ({
          name,
          protected: !!allVars[name]?.protected,
        })),
        count: filtered.length,
      };
    }

    return { variables: filtered, count: filtered.length };
  }

  private ensureReadAccess(name: string): void {
    if (!validateVariableName(name)) {
      throw new Error(`Invalid variable name '${name}'. Must match [A-Za-z_][A-Za-z0-9_]*`);
    }

    if (!getDefaultAccessFlag(this.config, 'read', this.currentClientId)
      && !resolveAccessRuleFlag(name, this.config, 'read', this.currentClientId)) {
      throw new Error('AI read access is disabled');
    }

    if (isBlacklisted(name, this.config)) {
      throw new Error(`Variable '${name}' is blacklisted and cannot be accessed`);
    }

    if (!canAccessVariable(name, this.config, 'read', this.currentClientId)) {
      throw new Error(`Access denied to variable '${name}'`);
    }
  }

  private async resolveProtectedValue(
    name: string,
    variable: Variable,
    providedPassword: string | undefined,
  ): Promise<string> {
    if (!providedPassword) {
      await this.logEvent({
        timestamp: new Date().toISOString(),
        operation: 'get',
        variable: name,
        source: 'api',
        success: false,
        message: 'Protected variable access denied — no password provided',
      });
      throw new Error(`Variable '${name}' is protected. Provide variable_password to access it.`);
    }

    if (!variable.password_hash || !await verifyVariablePassword(providedPassword, variable.password_hash)) {
      await this.logEvent({
        timestamp: new Date().toISOString(),
        operation: 'get',
        variable: name,
        source: 'api',
        success: false,
        message: 'Protected variable access denied — wrong password',
      });
      throw new Error(`Invalid password for protected variable '${name}'`);
    }

    return decryptVariableValue(variable.protected_value!, providedPassword);
  }

  protected async getVariable(args: { name: string; show_value?: boolean; variable_password?: string }): Promise<{
    name: string;
    value: string;
    tags?: string[];
    description?: string;
    encrypted: boolean;
    protected: boolean;
  }> {
    this.ensureReadAccess(args.name);

    const variable = await this.storage.get(args.name);

    if (!variable) {
      throw new Error(`Variable '${args.name}' not found`);
    }

    const canReveal = args.show_value
      && !this.config.access.mask_values
      && !requiresConfirmationForVariable(args.name, this.config, this.currentClientId);

    if (variable.protected) {
      const decryptedValue = await this.resolveProtectedValue(args.name, variable, args.variable_password);

      variable.accessed = new Date().toISOString();
      await this.storage.set(args.name, variable);

      const value = canReveal ? decryptedValue : maskValue(decryptedValue);

      await this.logEvent({
        timestamp: new Date().toISOString(),
        operation: 'get',
        variable: args.name,
        source: 'api',
        success: true,
        message: canReveal ? 'Protected value revealed' : 'Protected value masked',
      });

      return {
        name: variable.name,
        value,
        tags: variable.tags,
        description: variable.description,
        encrypted: variable.encrypted,
        protected: true,
      };
    }

    variable.accessed = new Date().toISOString();
    await this.storage.set(args.name, variable);

    const value = canReveal ? variable.value : maskValue(variable.value);

    await this.logEvent({
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
      protected: false,
    };
  }

  private async handleUnprotect(
    args: { name: string; value: string; tags?: string[]; description?: string; variable_password?: string },
    existing: Variable | undefined,
    now: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!existing?.protected) {
      throw new Error(`Variable '${args.name}' is not protected`);
    }
    if (!args.variable_password) {
      throw new Error('variable_password is required to remove protection');
    }
    if (!await verifyVariablePassword(args.variable_password, existing.password_hash!)) {
      throw new Error(`Invalid password for protected variable '${args.name}'`);
    }

    const decryptedValue = await decryptVariableValue(existing.protected_value!, args.variable_password);

    const variable: Variable = {
      name: args.name,
      value: args.value ?? decryptedValue,
      encrypted: this.config.storage.encrypted,
      tags: args.tags ?? existing.tags,
      description: args.description ?? existing.description,
      created: existing.created,
      updated: now,
      sync_to_env: true,
      protected: false,
    };

    await this.storage.set(args.name, variable);

    await this.logEvent({
      timestamp: now,
      operation: 'update',
      variable: args.name,
      source: 'api',
      success: true,
      message: 'Variable protection removed',
    });

    return { success: true, message: `Variable '${args.name}' protection removed` };
  }

  private async handleProtect(
    args: { name: string; value: string; tags?: string[]; description?: string; variable_password?: string },
    existing: Variable | undefined,
    now: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!args.variable_password) {
      throw new Error('variable_password is required when protect=true');
    }

    if (existing?.protected && !await verifyVariablePassword(args.variable_password, existing.password_hash!)) {
      throw new Error(`Invalid password for protected variable '${args.name}'`);
    }

    const passwordHash = await hashVariablePassword(args.variable_password);
    const protectedValue = await encryptVariableValue(args.value, args.variable_password);

    const variable: Variable = {
      name: args.name,
      value: '[PROTECTED]',
      encrypted: this.config.storage.encrypted,
      tags: args.tags ?? existing?.tags,
      description: args.description ?? existing?.description,
      created: existing?.created || now,
      updated: now,
      sync_to_env: true,
      protected: true,
      password_hash: passwordHash,
      protected_value: protectedValue,
    };

    await this.storage.set(args.name, variable);

    await this.logEvent({
      timestamp: now,
      operation: existing ? 'update' : 'add',
      variable: args.name,
      source: 'api',
      success: true,
      message: `Protected variable ${existing ? 'updated' : 'created'}`,
    });

    return { success: true, message: `Protected variable '${args.name}' ${existing ? 'updated' : 'created'}` };
  }

  protected async setVariable(args: {
    name: string;
    value: string;
    tags?: string[];
    description?: string;
    protect?: boolean;
    unprotect?: boolean;
    variable_password?: string;
  }): Promise<{ success: boolean; message: string }> {
    if (!validateVariableName(args.name)) {
      throw new Error(`Invalid variable name '${args.name}'. Must match [A-Za-z_][A-Za-z0-9_]*`);
    }

    if (isBlacklisted(args.name, this.config)) {
      throw new Error(`Variable '${args.name}' is blacklisted`);
    }

    this.ensureVariableOperationAllowed(
      args.name,
      'write',
      'AI write access is disabled',
      `AI write access is denied for variable '${args.name}'`,
    );

    if (this.config.access.require_variable_password && !args.protect && !args.unprotect) {
      const existing = await this.storage.get(args.name);
      if (!existing) {
        throw new Error('require_variable_password is enabled — new variables must use protect=true with a variable_password');
      }
    }

    const existing = await this.storage.get(args.name);
    const now = new Date().toISOString();

    if (args.unprotect) {
      return this.handleUnprotect(args, existing, now);
    }

    if (args.protect) {
      return this.handleProtect(args, existing, now);
    }

    if (existing?.protected) {
      /* c8 ignore next -- protected variables are always updated via protect/unprotect flow in public API; this guard remains defensive */
      if (!args.variable_password) {
        throw new Error(`Variable '${args.name}' is protected. Provide variable_password and protect=true to update.`);
      }
    }

    const variable: Variable = {
      name: args.name,
      value: args.value,
      encrypted: this.config.storage.encrypted,
      tags: args.tags,
      description: args.description,
      created: existing?.created || now,
      updated: now,
      sync_to_env: true,
      protected: false,
    };

    await this.storage.set(args.name, variable);

    await this.logEvent({
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
    if (!validateVariableName(args.name)) {
      throw new Error(`Invalid variable name '${args.name}'. Must match [A-Za-z_][A-Za-z0-9_]*`);
    }

    this.ensureVariableOperationAllowed(
      args.name,
      'delete',
      'AI delete access is disabled',
      `AI delete access is denied for variable '${args.name}'`,
    );

    const deleted = await this.storage.delete(args.name);

    await this.logEvent({
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

  // Canonicalize via realpath so containment check can't be bypassed by an in-project symlink (fs.writeFile follows symlinks).
  private async canonicalizeEnvPath(envPath: string): Promise<{ envPathReal: string; projectRootReal: string }> {
    const projectRootReal = await fs.realpath(this.projectPath);
    let envPathReal = envPath;
    try {
      envPathReal = await fs.realpath(envPath);
    } catch {
      try {
        const target = await fs.readlink(envPath);
        envPathReal = path.resolve(path.dirname(envPath), target);
      } catch {
        const envDir = path.dirname(envPath);
        try {
          const envDirReal = await fs.realpath(envDir);
          envPathReal = path.join(envDirReal, path.basename(envPath));
        } catch {
          // Parent doesn't exist; leave lexical. The subsequent write will fail.
        }
      }
    }
    return { envPathReal, projectRootReal };
  }

  protected async syncToEnv(): Promise<{ success: boolean; message: string }> {
    const defaultExportEnabled = getDefaultAccessFlag(this.config, 'export', this.currentClientId);
    const hasAccessibleExport = Object.keys(await this.storage.load()).some((name) =>
      canAccessVariable(name, this.config, 'export', this.currentClientId)
    );
    if (!defaultExportEnabled && !hasAccessibleExport) {
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
      if (!canAccessVariable(name, this.config, 'export', this.currentClientId)) {
        continue;
      }

      const excluded = this.config.sync.exclude?.some(pattern => matchesPattern(name, pattern));

      if (excluded || !variable.sync_to_env) {
        continue;
      }

      const needsQuoting = /[\s#"'\\]/.test(variable.value);
      const val = needsQuoting ? `"${variable.value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : variable.value;
      lines.push(`${name}=${val}`);
    }

    const envPath = path.resolve(this.projectPath, this.config.sync.target);
    const { envPathReal, projectRootReal } = await this.canonicalizeEnvPath(envPath);

    if (envPathReal !== projectRootReal && !envPathReal.startsWith(`${projectRootReal}${path.sep}`)) {
      throw new Error('sync.target must be within the project directory');
    }

    await fs.writeFile(envPath, lines.join('\n'), 'utf8');

    await this.logEvent({
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

    this.ensureVariableOperationAllowed(
      args.name,
      'export',
      'AI export access is disabled',
      `AI export access is denied for variable '${args.name}'`,
    );

    const envPath = path.resolve(this.projectPath, args.env_file || '.env');
    const { envPathReal, projectRootReal } = await this.canonicalizeEnvPath(envPath);
    if (envPathReal !== projectRootReal && !envPathReal.startsWith(`${projectRootReal}${path.sep}`)) {
      throw new Error('env_file must be within the project directory');
    }

    let content = '';

    if (await pathExists(envPath)) {
      content = await fs.readFile(envPath, 'utf8');
    }

    const envVars = parseEnv(content);

    const needsQuoting = /[\s#"'\\]/.test(variable.value);
    const quotedValue = needsQuoting ? `"${variable.value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : variable.value;

    if (envVars[args.name]) {
      const lines = content.split('\n');
      const newLines = lines.map(line => {
        if (line.startsWith(`${args.name}=`)) {
          return `${args.name}=${quotedValue}`;
        }
        return line;
      });
      content = newLines.join('\n');
    } else {
      content += `\n${args.name}=${quotedValue}`;
    }

    await fs.writeFile(envPath, content, 'utf8');

    await this.logEvent({
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
    accessible: boolean;
    message: string;
  }> {
    if (!validateVariableName(args.name)) {
      throw new Error(`Invalid variable name '${args.name}'. Must match [A-Za-z_][A-Za-z0-9_]*`);
    }

    const variable = await this.storage.get(args.name);
    const exists = !!variable;
    const blacklisted = isBlacklisted(args.name, this.config);
    const accessible = exists && !blacklisted && canAccessVariable(args.name, this.config, 'read', this.currentClientId);

    await this.logEvent({
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

  private ensureVariableOperationAllowed(
    name: string,
    operation: 'read' | 'write' | 'delete' | 'export',
    disabledMessage: string,
    deniedMessage: string,
  ): void {
    if (!getDefaultAccessFlag(this.config, operation, this.currentClientId)
      && !resolveAccessRuleFlag(name, this.config, operation, this.currentClientId)) {
      throw new Error(disabledMessage);
    }

    if (!canAccessVariable(name, this.config, operation, this.currentClientId)) {
      throw new Error(deniedMessage);
    }
  }

  private parseCommand(command: string): { program: string; args: string[] } {
    const tokens: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;

    for (const ch of command) {
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

    if (inSingle || inDouble) throw new Error('Mismatched quotes in command');
    if (tokens.length === 0) throw new Error('Empty command');
    return { program: tokens[0], args: tokens.slice(1) };
  }

  private validateCommand(command: string): void {
    const shellMetachars = /[;&|`$(){}!><\n\\]/;
    if (shellMetachars.test(command)) {
      throw new Error('Command contains disallowed shell metacharacters: ; & | ` $ ( ) { } ! > < \\ and newline (\\n)');
    }

    // Check user-configured command blacklist (substring match, case-insensitive)
    const blacklist = this.config.access.command_blacklist;
    const lowerCommand = command.toLowerCase();
    for (const pattern of blacklist) {
      if (lowerCommand.includes(pattern.toLowerCase())) {
        throw new Error(`Command rejected: matches blacklisted pattern "${pattern}"`);
      }
    }
  }

  /**
   * Detects destructive rm invocations targeting the root filesystem.
   * Checks for recursive (-r/--recursive) + any arg that resolves to /, including
   * path-equivalent variants like //, /./, /../ (normalized before comparison).
   */
  private checkRootDelete(prog: string, cmdArgs: string[]): void {
    const basename = prog.split('/').pop() as string;
    if (basename !== 'rm') return;

    const hasRecursive = cmdArgs.some(a =>
      /^-[^-]*[rR]/.test(a) || a === '--recursive'
    );

    // Normalize each arg to resolve //, /./, /../ etc. before comparing.
    // Trailing glob wildcards (/* or /**) are replaced with / so that
    // path.resolve still correctly identifies root-targeting patterns.
    const hasRootTarget = cmdArgs.some(a => {
      if (!a.startsWith('/')) return false;
      const withoutGlob = a.replace(/\/\*+$/, '/');
      return path.resolve(withoutGlob) === '/';
    });

    if (hasRecursive && hasRootTarget) {
      throw new Error('Command rejected: recursive delete targeting root filesystem is not allowed (disallow_root_delete)');
    }
  }

  /**
   * Validates that a critical environment variable value is safe.
   * Rejects HOME/TMPDIR set to root, and PATH entries containing `..` as a path segment.
   * OWASP A01:2025 – CWE-22 (Path Traversal) via environment variable manipulation
   */
  private validateEnvVarValue(key: string, value: string): void {
    if (key === 'HOME' || key === 'TMPDIR' || key === 'TMP' || key === 'TEMP') {
      if (path.resolve(value) === '/') {
        throw new Error(`Environment variable ${key} cannot be set to root "/" (disallow_path_manipulation)`);
      }
    }
    if (key === 'PATH') {
      // Use platform delimiter (: on Unix, ; on Windows)
      const segments = value.split(path.delimiter);
      for (const seg of segments) {
        // Check for `..` as a path segment, not as a substring (e.g. /foo..bar is fine)
        if (path.normalize(seg).split(path.sep).includes('..')) {
          throw new Error(`Environment variable PATH contains directory traversal ".." (disallow_path_manipulation)`);
        }
      }
    }
  }

  protected async runCommand(args: { command: string; variables: string[] }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }> {
    if (!getDefaultAccessFlag(this.config, 'execute', this.currentClientId)
      && !args.variables.some((name) => canAccessVariable(name, this.config, 'execute', this.currentClientId))) {
      throw new Error('AI command execution is disabled');
    }

    this.validateCommand(args.command);

    const { spawn } = await import('node:child_process');
    const { program: prog, args: cmdArgs } = this.parseCommand(args.command);

    // Enforce require_command_whitelist: allowed_commands must exist and contain the program
    if (this.config.access.run_safety?.require_command_whitelist) {
      if (!this.config.access.allowed_commands?.includes(prog)) {
        throw new Error(`Command '${prog}' is not in the allowed commands list (require_command_whitelist is enabled)`);
      }
    } else if (this.config.access.allowed_commands && this.config.access.allowed_commands.length > 0) {
      if (!this.config.access.allowed_commands.includes(prog)) {
        throw new Error(`Command '${prog}' is not in the allowed commands list`);
      }
    }

    // Destructive command check (post-parse, uses structured tokens)
    if (this.config.access.run_safety?.disallow_root_delete) {
      this.checkRootDelete(prog, cmdArgs);
    }

    // Build a minimal env: only inherit safe system vars + requested secrets
    const SAFE_INHERIT = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'NODE_ENV', 'TMPDIR', 'TMP', 'TEMP'];
    const CRITICAL_KEYS = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP']);
    const env: Record<string, string> = {};
    for (const key of SAFE_INHERIT) {
      if (process.env[key]) env[key] = process.env[key]!;
    }

    const excludedVariables: string[] = [];

    for (const name of args.variables) {
      const blacklisted = isBlacklisted(name, this.config);
      const accessible = canAccessVariable(name, this.config, 'execute', this.currentClientId);

      if (blacklisted || !accessible) {
        excludedVariables.push(name);
        await this.logEvent({
          timestamp: new Date().toISOString(),
          operation: 'check_access',
          variable: name,
          source: 'api',
          success: false,
          message: `Excluded from envcp_run due to policy (${blacklisted ? 'blacklist' : 'access'})`,
        });
        continue;
      }

      const variable = await this.storage.get(name);
      if (variable) {
        env[name] = variable.value;
      }
    }

    // Validate the final env after all injection — prevents bypass by a vault variable
    // named PATH/HOME/TMPDIR overriding the inherited value after validation.
    // OWASP A01:2025 – CWE-22: validate after injection, not before
    if (this.config.access.run_safety?.disallow_path_manipulation) {
      for (const key of Object.keys(env)) {
        if (CRITICAL_KEYS.has(key)) {
          this.validateEnvVarValue(key, env[key]);
        }
      }
    }

    const injectedNames = args.variables.filter(n => !excludedVariables.includes(n));
    const TIMEOUT_MS = 30000;

    // Create process Promise first so the timeout is registered synchronously
    // before any async log I/O — this keeps fake-timer tests working correctly.
    const processPromise = new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
      const proc = spawn(prog, cmdArgs, {
        env,
        cwd: this.projectPath,
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
      }, TIMEOUT_MS);

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          stderr += '\n[Process killed: exceeded 30s timeout]';
        }
        if (excludedVariables.length > 0) {
          stderr += `\n[envcp] Excluded variables by policy (not injected): ${excludedVariables.join(', ')}`;
        }
        resolve({ exitCode: code, stdout, stderr });
      });
    });

    // Audit log: command start (variable names only — never values)
    await this.logEvent({
      timestamp: new Date().toISOString(),
      operation: 'run',
      variable: args.command,
      source: 'api',
      success: true,
      message: `Starting: ${args.command} (injected: ${injectedNames.join(', ') || 'none'})`,
    });

    const result = await processPromise;

    // Scrub injected secret values and common secret patterns from output
    // before returning to the AI agent (default: on).
    const scrub = this.config.access.run_safety?.scrub_output !== false;
    if (scrub) {
      const injectedValues = injectedNames
        .map(name => env[name])
        .filter((v): v is string => typeof v === 'string');
      const extraPatterns = this.config.access.run_safety?.redact_patterns ?? [];
      result.stdout = scrubOutput(result.stdout, injectedValues, extraPatterns);
      result.stderr = scrubOutput(result.stderr, injectedValues, extraPatterns);
    }

    // Audit log: command exit (exit code only — no stdout/stderr values)
    await this.logEvent({
      timestamp: new Date().toISOString(),
      operation: 'run',
      variable: args.command,
      source: 'api',
      success: result.exitCode === 0,
      message: `Exited with code ${result.exitCode}`,
    });

    return result;
  }

  protected createHttpServer(
    opts: {
      port: number;
      host: string;
      apiKey?: string;
      rateLimitConfig?: RateLimitConfig;
      defaultClientId: string;
      authHeaderFn: (req: http.IncomingMessage) => string | undefined;
      onRequest: (req: http.IncomingMessage, res: http.ServerResponse, pathname: string, clientId: string) => Promise<void>;
      authFailureResponse?: (message: string) => unknown;
      internalErrorResponse?: (message: string) => unknown;
      healthEndpoints: string[];
      mode: string;
    },
  ): Promise<http.Server> {
    const rateLimiter = new RateLimiter(opts.rateLimitConfig?.requests_per_minute ?? 60, 60000);
    const rateLimitEnabled = opts.rateLimitConfig?.enabled !== false;
    const whitelist = opts.rateLimitConfig?.whitelist ?? [];

    const server = http.createServer(async (req, res) => {
      setCorsHeaders(res, undefined, req.headers.origin);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (rateLimitEnabled && !rateLimitMiddleware(rateLimiter, req, res, whitelist)) {
        return;
      }

      if (opts.apiKey) {
        const providedKey = opts.authHeaderFn(req);
        if (!validateApiKey(providedKey, opts.apiKey)) {
          await this.logs.log({ timestamp: new Date().toISOString(), operation: 'auth_failure', variable: '', source: 'api', success: false, message: `Invalid API key from ${req.socket.remoteAddress ?? 'unknown'}` });
          sendJson(res, 401, opts.authFailureResponse?.('Invalid API key') ?? { error: { code: 401, message: 'Invalid API key', status: 'UNAUTHENTICATED' } });
          return;
        }
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      const clientIdHeader = req.headers['x-envcp-client-id'];
      /* c8 ignore next -- duplicate headers collapse in normal CLI/server usage */
      const clientId = (Array.isArray(clientIdHeader) ? clientIdHeader[0] : clientIdHeader) || opts.defaultClientId;

      try {
        await opts.onRequest(req, res, pathname, clientId);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, opts.internalErrorResponse?.(message) ?? { error: { code: 500, message, status: 'INTERNAL' } });
      }
    });

    return new Promise((resolve) => {
      server.listen(opts.port, opts.host, () => {
        resolve(server);
      });
    });
  }

  /**
   * Common startup wrapper for branded HTTP adapters (OpenAI/Gemini):
   * runs init(), then createHttpServer() with the standard /v1/health endpoints.
   */
  protected async startBrandedHttpServer(
    opts: {
      port: number;
      host: string;
      apiKey?: string;
      rateLimitConfig?: RateLimitConfig;
      defaultClientId: string;
      authHeaderFn: (req: http.IncomingMessage) => string | undefined;
      onRequest: (req: http.IncomingMessage, res: http.ServerResponse, pathname: string, clientId: string) => Promise<void>;
      authFailureResponse?: (message: string) => unknown;
      internalErrorResponse?: (message: string) => unknown;
      mode: string;
    },
  ): Promise<http.Server> {
    await this.init();
    return this.createHttpServer({
      ...opts,
      healthEndpoints: ['/v1/health', '/'],
    });
  }
}
