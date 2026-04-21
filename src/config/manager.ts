import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { ensureDir, pathExists, parseEnv } from '../utils/fs.js';
import { EnvCPConfig, EnvCPConfigSchema } from '../types.js';
import { generateConfigHmac, verifyConfigHmac, deriveHmacKey, getSystemIdentifier } from './config-hmac.js';

const DEFAULT_CONFIG: Partial<EnvCPConfig> = {
  version: '1.0',
  vault: {
    default: 'project',
    global_path: '.envcp/store.enc',
  },
  storage: {
    path: '.envcp/store.enc',
    encrypted: true,
  },
  access: {
    variable_rules: {},
    client_rules: {},
    allow_ai_read: false,
    allow_ai_write: false,
    allow_ai_delete: false,
    allow_ai_export: false,
    allow_ai_execute: false,
    allow_ai_active_check: false,
    allow_ai_logs: false,
    logs_default_role: 'own_sessions',
    logs_roles: { cli: 'full' },
    require_user_reference: true,
    allowed_commands: undefined,
    require_confirmation: true,
    mask_values: true,
    audit_log: true,
    blacklist_patterns: ['*_SECRET', '*_PRIVATE', 'ADMIN_*', 'ROOT_*'],
    require_variable_password: false,
    command_blacklist: ['mkfs', 'shred', 'wipefs', 'fdisk', 'parted', 'dd', 'chattr'],
    run_safety: {
      disallow_root_delete: true,
      disallow_path_manipulation: true,
      require_command_whitelist: false,
      scrub_output: true,
      redact_patterns: [],
    },
  },
  sync: {
    enabled: false,
    target: '.env',
    exclude: [],
    format: 'dotenv',
  },
  session: {
    enabled: true,
    timeout_minutes: 30,
    max_extensions: 5,
    path: '.envcp/.session',
    lockout_threshold: 5,
    lockout_base_seconds: 30,
  },
  encryption: {
    enabled: true,
  },
  security: {
    mode: 'recoverable',
    recovery_file: '.envcp/.recovery',
    brute_force_protection: {
      enabled: true,
      max_attempts: 5,
      lockout_duration: 300,
      progressive_delay: true,
      max_delay: 60,
      permanent_lockout_threshold: 50,
      permanent_lockout_action: 'require_recovery_key',
      notifications: {},
    },
  },
  password: {
    min_length: 8,
    require_complexity: false,
    allow_numeric_only: false,
    allow_single_char: false,
  },
  hsm: {
    enabled: false,
    type: 'yubikey' as const,
    require_touch: true,
    protected_key_path: '.envcp/.hsm-key',
  },
  auth: {
    method: 'password' as const,
    multi_factors: ['password', 'hsm'] as Array<'password' | 'keychain' | 'hsm'>,
    fallback: 'password' as const,
  },
};

// Deep merge utility: project values override global, arrays are replaced
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) && tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      /* c8 ignore next -- branch mapped incorrectly, statement covered */
      result[key] = srcVal;
    }
  }
  return result;
}

async function loadYamlObjectIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  if (!await pathExists(filePath)) {
    return null;
  }

  const content = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA });
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

async function verifyProjectConfigSignature(projectPath: string): Promise<void> {
  const projectConfigPath = path.join(projectPath, 'envcp.yaml');
  const sigPath = path.join(projectPath, '.envcp', '.config_signature');
  const hmacKey = deriveHmacKey(getSystemIdentifier());

  if (await pathExists(sigPath) && await pathExists(projectConfigPath)) {
    const storedHmac = await fs.readFile(sigPath, 'utf8');
    const projectContent = await fs.readFile(projectConfigPath, 'utf8');
    if (!verifyConfigHmac(projectContent, storedHmac, hmacKey)) {
      throw new Error('Config integrity check failed: envcp.yaml has been tampered with or corrupted. Verify the file or remove .envcp/.config_signature to regenerate.');
    }
  }
}

export type ConfigScope = 'project' | 'home' | 'merged';

export async function loadConfig(projectPath: string): Promise<EnvCPConfig> {
  const home = getHomeDir();
  const globalConfigPath = path.join(home, '.envcp', 'config.yaml');
  const projectConfigPath = path.join(projectPath, 'envcp.yaml');

  await verifyProjectConfigSignature(projectPath);

  let merged: Record<string, unknown> = DEFAULT_CONFIG as Record<string, unknown>;

  // Layer 1: global config (~/.envcp/config.yaml)
  const globalConfig = await loadYamlObjectIfExists(globalConfigPath);
  if (globalConfig) {
    merged = deepMerge(merged, globalConfig);
  }

  // Layer 2: project config (envcp.yaml) — overrides global
  const projectConfig = await loadYamlObjectIfExists(projectConfigPath);
  if (projectConfig) {
    merged = deepMerge(merged, projectConfig);
  }

  return EnvCPConfigSchema.parse(merged);
}

export async function loadScopedConfig(projectPath: string, scope: ConfigScope): Promise<EnvCPConfig> {
  if (scope === 'merged') {
    return loadConfig(projectPath);
  }

  const home = getHomeDir();
  let merged: Record<string, unknown> = DEFAULT_CONFIG as Record<string, unknown>;

  if (scope === 'home') {
    const globalConfigPath = path.join(home, '.envcp', 'config.yaml');
    const globalConfig = await loadYamlObjectIfExists(globalConfigPath);
    if (globalConfig) {
      merged = deepMerge(merged, globalConfig);
    }
    return EnvCPConfigSchema.parse(merged);
  }

  await verifyProjectConfigSignature(projectPath);
  const projectConfigPath = path.join(projectPath, 'envcp.yaml');
  const projectConfig = await loadYamlObjectIfExists(projectConfigPath);
  if (projectConfig) {
    merged = deepMerge(merged, projectConfig);
  }
  return EnvCPConfigSchema.parse(merged);
}

export async function saveConfigSignature(projectPath: string, configContent: string, key: string): Promise<void> {
  const envcpDir = path.join(projectPath, '.envcp');
  await ensureDir(envcpDir);
  const sigPath = path.join(envcpDir, '.config_signature');
  const hmac = generateConfigHmac(configContent, key);
  await fs.writeFile(sigPath, hmac, { encoding: 'utf8', mode: 0o600 });
}

export interface ConfigPathOptions {
  global?: boolean;
}

export function getConfigFilePath(projectPath: string, options?: ConfigPathOptions): string {
  return options?.global
    ? path.join(projectPath, '.envcp', 'config.yaml')
    : path.join(projectPath, 'envcp.yaml');
}

export async function saveConfig(config: EnvCPConfig, projectPath: string, options?: ConfigPathOptions): Promise<void> {
  const configPath = getConfigFilePath(projectPath, options);
  await ensureDir(path.dirname(configPath));
  const content = yaml.dump(config, { indent: 2, lineWidth: -1 });
  await fs.writeFile(configPath, content, { encoding: 'utf8', mode: 0o600 });
  // Signature is stored alongside the project's .envcp dir; for global mode the
  // signature lives in ~/.envcp/.config_signature, which is also the base.
  const key = deriveHmacKey(getSystemIdentifier());
  await saveConfigSignature(projectPath, content, key);
}

export async function saveScopedConfig(config: EnvCPConfig, projectPath: string, scope: Exclude<ConfigScope, 'merged'>): Promise<void> {
  if (scope === 'home') {
    const home = getHomeDir();
    await saveConfig(config, home, { global: true });
    return;
  }

  await saveConfig(config, projectPath);
}

export async function initConfig(projectPath: string, projectName?: string, options?: ConfigPathOptions): Promise<EnvCPConfig> {
  const envcpDir = path.join(projectPath, '.envcp');
  await ensureDir(envcpDir);
  await ensureDir(path.join(envcpDir, 'logs'));

  const baseConfig = { ...DEFAULT_CONFIG } as EnvCPConfig;
  if (options?.global) {
    baseConfig.vault = { ...baseConfig.vault, mode: 'global' };
  }

  const config: EnvCPConfig = {
    ...baseConfig,
    project: projectName || path.basename(projectPath),
  } as EnvCPConfig;

  await saveConfig(config, projectPath, options);

  // .gitignore management only makes sense for project-local installs.
  if (!options?.global) {
    const gitignorePath = path.join(projectPath, '.gitignore');
    if (await pathExists(gitignorePath)) {
      const gitignore = await fs.readFile(gitignorePath, 'utf8');
      if (!gitignore.includes('.envcp/')) {
        await fs.appendFile(gitignorePath, '\n# EnvCP\n.envcp/\nstore.enc\n');
      }
    } else {
      await fs.writeFile(gitignorePath, '# EnvCP\n.envcp/\nstore.enc\n');
    }
  }

  return config;
}

// MCP registration target definition
interface McpTarget {
  name: string;
  getPath: (projectPath: string, home: string, platform: string) => string;
  projectLocal: boolean;  // Written into project dir
  requireExisting: boolean; // Only register if config file already exists
  detectDir?: string; // For project-local: only create if this dir exists
  format: 'mcpServers' | 'servers' | 'context_servers' | 'mcp_key' | 'mcp_servers_array';
}

function globalMcpTarget(name: string, getPath: McpTarget['getPath'], format: McpTarget['format']): McpTarget {
  return { name, getPath, projectLocal: false, requireExisting: true, format };
}

function getRoamingConfigPath(home: string, ...segments: string[]): string {
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return path.join(appData, ...segments);
}

function getMcpTargets(): McpTarget[] {
  return [
    // --- Global configs (require existing file = tool is installed) ---
    globalMcpTarget('Claude Desktop', (_proj, home, platform) => {
      if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      if (platform === 'win32') return getRoamingConfigPath(home, 'Claude', 'claude_desktop_config.json');
      return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
    }, 'mcpServers'),
    globalMcpTarget('Claude Code', (_proj, home) => path.join(home, '.claude', 'mcp.json'), 'mcpServers'),
    globalMcpTarget('Cursor', (_proj, home) => path.join(home, '.cursor', 'mcp.json'), 'mcpServers'),
    globalMcpTarget('Windsurf', (_proj, home) => path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers'),
    globalMcpTarget('Zed', (_proj, home, platform) => {
      if (platform === 'win32') return getRoamingConfigPath(home, 'Zed', 'settings.json');
      return path.join(home, '.config', 'zed', 'settings.json');
    }, 'context_servers'),
    globalMcpTarget('Continue.dev', (_proj, home) => path.join(home, '.continue', 'mcp.json'), 'mcpServers'),
    globalMcpTarget('OpenCode', (_proj, home) => path.join(home, '.config', 'opencode', 'opencode.json'), 'mcp_key'),
    globalMcpTarget('GitHub Copilot CLI', (_proj, home) => path.join(home, '.copilot', 'mcp-config.json'), 'mcp_servers_array'),
    // --- Project-local configs (create if tool dir detected) ---
    {
      name: 'Cursor (project)',
      getPath: (proj) => path.join(proj, '.cursor', 'mcp.json'),
      projectLocal: true, requireExisting: false, detectDir: '.cursor', format: 'mcpServers',
    },
    {
      name: 'VS Code',
      getPath: (proj) => path.join(proj, '.vscode', 'mcp.json'),
      projectLocal: true, requireExisting: false, detectDir: '.vscode', format: 'servers',
    },
    {
      name: 'JetBrains',
      getPath: (proj) => path.join(proj, '.jb-mcp.json'),
      projectLocal: true, requireExisting: false, detectDir: '.idea', format: 'mcpServers',
    },
    {
      name: 'Google AntiGravity',
      getPath: (proj) => path.join(proj, 'mcp_config.json'),
      projectLocal: true, requireExisting: false, format: 'mcpServers',
    },
  ];
}

// Format-specific entry creation
function createMcpEntry(projectPath: string, isProjectLocal: boolean): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: 'npx',
    args: ['envcp', 'serve', '--mode', 'mcp'],
  };
  if (!isProjectLocal) entry.cwd = projectPath;
  return entry;
}

export function writeToConfig(
  config: Record<string, unknown>,
  format: McpTarget['format'],
  entry: Record<string, unknown>,
): { written: boolean; alreadyExists: boolean } {
  switch (format) {
    case 'mcpServers': {
      if (!config.mcpServers) config.mcpServers = {};
      const servers = config.mcpServers as Record<string, unknown>;
      if (servers.envcp) return { written: false, alreadyExists: true };
      servers.envcp = entry;
      return { written: true, alreadyExists: false };
    }
    case 'servers': {
      if (!config.servers) config.servers = {};
      const servers = config.servers as Record<string, unknown>;
      if (servers.envcp) return { written: false, alreadyExists: true };
      servers.envcp = entry;
      return { written: true, alreadyExists: false };
    }
    case 'context_servers': {
      if (!config.context_servers) config.context_servers = {};
      const servers = config.context_servers as Record<string, unknown>;
      if (servers.envcp) return { written: false, alreadyExists: true };
      servers.envcp = { command: { path: entry.command, args: entry.args, env: {} } };
      return { written: true, alreadyExists: false };
    }
    case 'mcp_key': {
      if (!config.mcp) config.mcp = {};
      const mcp = config.mcp as Record<string, unknown>;
      if (mcp.envcp) return { written: false, alreadyExists: true };
      mcp.envcp = { type: 'local', command: ['npx', 'envcp', 'serve', '--mode', 'mcp'], enabled: true };
      return { written: true, alreadyExists: false };
    }
    case 'mcp_servers_array': {
      if (!config.mcp_servers) config.mcp_servers = [];
      const servers = config.mcp_servers as Array<Record<string, unknown>>;
      if (servers.some(s => s.name === 'envcp')) return { written: false, alreadyExists: true };
      servers.push({ name: 'envcp', type: 'stdio', ...entry });
      return { written: true, alreadyExists: false };
    }
  }
}

export async function registerMcpConfig(projectPath: string): Promise<{ registered: string[]; alreadyConfigured: string[]; manual: string[] }> {
  /* c8 ignore next -- HOME or USERPROFILE always set in supported environments */
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const platform = process.platform;
  const targets = getMcpTargets();

  const registered: string[] = [];
  const alreadyConfigured: string[] = [];
  const manual: string[] = ['Trae (add manually to trae_config.yaml)', 'Aider (register via aider-mcp CLI)'];

  for (const target of targets) {
    const configPath = target.getPath(projectPath, home, platform);

    // For project-local: check if the tool's directory exists
    if (target.projectLocal && target.detectDir) {
      const dirPath = path.join(projectPath, target.detectDir);
      if (!await pathExists(dirPath)) continue;
    }

    // For global configs that don't exist yet: skip (tool not installed)
    if (target.requireExisting && !await pathExists(configPath)) continue;

    // For project-local Google AntiGravity: always skip creating the file fresh
    // (only update if it already exists, since we can't detect the tool)
    if (target.name === 'Google AntiGravity' && !await pathExists(configPath)) continue;

    try {
      let config: Record<string, unknown> = {};
      if (await pathExists(configPath)) {
        const content = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(content);
      }

      const entry = createMcpEntry(projectPath, target.projectLocal);
      const result = writeToConfig(config, target.format, entry);

if (result.alreadyExists) {
        alreadyConfigured.push(target.name);
        continue;
      }

      await ensureDir(path.dirname(configPath));
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      registered.push(target.name);
    } catch {
      /* c8 ignore next -- rare: invalid JSON or permission errors are silently skipped */
    }
  }

  return { registered, alreadyConfigured, manual };
}

/**
 * Parses a `.env` file into a key/value map with strict dotenv semantics.
 * Handles double-quoted values with backslash escape sequences (`\"`, `\\`).
 * Single-quoted values are taken literally. Lines starting with `#` are ignored.
 * Keys that are not valid POSIX identifiers are dropped.
 * @param content - Raw text content of a `.env` file
 */
export function parseEnvFile(content: string): Record<string, string> {
  return parseEnv(content, { validateNames: true, escapeStyle: 'dotenv' });
}

export function validateVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

const _patternCache = new Map<string, RegExp>();

export function matchesPattern(name: string, pattern: string): boolean {
  let regex = _patternCache.get(pattern);
  if (!regex) {
    const escaped = pattern.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- glob pattern from config; metacharacters escaped above
    regex = new RegExp('^' + escaped.replaceAll('*', '.*') + '$');
    _patternCache.set(pattern, regex);
  }
  return regex.test(name);
}

/**
 * Returns true if the variable `name` is permitted by the access policy.
 * Evaluated in order: blacklist → denied_patterns → allowed_patterns.
 * @security This is the primary access-control gate for AI-facing operations.
 */
export function canAccess(name: string, config: EnvCPConfig): boolean {
  if (config.access.blacklist_patterns && config.access.blacklist_patterns.length > 0) {
    if (config.access.blacklist_patterns.some((p: string) => matchesPattern(name, p))) {
      return false;
    }
  }

  if (config.access.denied_patterns && config.access.denied_patterns.length > 0) {
    if (config.access.denied_patterns.some((p: string) => matchesPattern(name, p))) {
      return false;
    }
  }

  if (config.access.allowed_patterns && config.access.allowed_patterns.length > 0) {
    if (!config.access.allowed_patterns.some((p: string) => matchesPattern(name, p))) {
      return false;
    }
  }
  
  return true;
}

export type VariableAccessOperation = 'read' | 'write' | 'delete' | 'export' | 'execute';

type VariableRule = EnvCPConfig['access']['variable_rules'][string];
type ClientAccessRule = EnvCPConfig['access']['client_rules'][string];

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

function isWindowActive(window: VariableRule['active_window'], now: Date): boolean {
  if (!window) {
    return true;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = toMinutes(window.start);
  const endMinutes = toMinutes(window.end);

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function getClientRule(config: EnvCPConfig, clientId = ''): ClientAccessRule | undefined {
  if (!clientId) {
    return undefined;
  }
  return config.access.client_rules?.[clientId];
}

function getClientVariableRule(name: string, config: EnvCPConfig, clientId = ''): VariableRule | undefined {
  return getClientRule(config, clientId)?.variable_rules?.[name];
}

export function isVariableRuleActive(
  name: string,
  config: EnvCPConfig,
  now: Date = new Date(),
  clientId = '',
): boolean {
  const globalWindow = config.access.variable_rules?.[name]?.active_window;
  const clientWindow = getClientVariableRule(name, config, clientId)?.active_window;
  return isWindowActive(globalWindow, now) && isWindowActive(clientWindow, now);
}

function getVariableRuleFlag(
  name: string,
  config: EnvCPConfig,
  operation: VariableAccessOperation,
  clientId = '',
): boolean | undefined {
  const clientRule = getClientVariableRule(name, config, clientId);
  const rule = config.access.variable_rules?.[name];

  switch (operation) {
    case 'read':
      return clientRule?.allow_ai_read ?? rule?.allow_ai_read;
    case 'write':
      return clientRule?.allow_ai_write ?? rule?.allow_ai_write;
    case 'delete':
      return clientRule?.allow_ai_delete ?? rule?.allow_ai_delete;
    case 'export':
      return clientRule?.allow_ai_export ?? rule?.allow_ai_export;
    case 'execute':
      return clientRule?.allow_ai_execute ?? rule?.allow_ai_execute;
  }
}

export function getDefaultAccessFlag(config: EnvCPConfig, operation: VariableAccessOperation, clientId = ''): boolean {
  const clientRule = getClientRule(config, clientId);
  switch (operation) {
    case 'read':
      return clientRule?.allow_ai_read ?? config.access.allow_ai_read;
    case 'write':
      return clientRule?.allow_ai_write ?? config.access.allow_ai_write;
    case 'delete':
      return clientRule?.allow_ai_delete ?? config.access.allow_ai_delete;
    case 'export':
      return clientRule?.allow_ai_export ?? config.access.allow_ai_export;
    case 'execute':
      return clientRule?.allow_ai_execute ?? config.access.allow_ai_execute;
  }
}

export function resolveAccessRuleFlag(
  name: string,
  config: EnvCPConfig,
  operation: VariableAccessOperation,
  clientId = '',
): boolean {
  return getVariableRuleFlag(name, config, operation, clientId) ?? getDefaultAccessFlag(config, operation, clientId);
}

export function canAccessVariable(
  name: string,
  config: EnvCPConfig,
  operation: VariableAccessOperation,
  clientId = '',
): boolean {
  if (isBlacklisted(name, config)) {
    return false;
  }

  if (!isVariableRuleActive(name, config, new Date(), clientId)) {
    return false;
  }

  const ruleFlag = getVariableRuleFlag(name, config, operation, clientId);
  if (ruleFlag === false) {
    return false;
  }
  if (ruleFlag === true) {
    return true;
  }

  return getDefaultAccessFlag(config, operation, clientId) && canAccess(name, config);
}

export function requiresConfirmationForVariable(name: string, config: EnvCPConfig, clientId = ''): boolean {
  const clientRule = getClientVariableRule(name, config, clientId);
  const clientDefaults = getClientRule(config, clientId);
  return clientRule?.require_confirmation
    ?? config.access.variable_rules?.[name]?.require_confirmation
    ?? clientDefaults?.require_confirmation
    ?? config.access.require_confirmation === true;
}

/**
 * Returns true if the variable `name` matches any `blacklist_patterns` entry.
 * Blacklisted variables are always denied regardless of other access rules.
 */
export function isBlacklisted(name: string, config: EnvCPConfig): boolean {
  if (config.access.blacklist_patterns && config.access.blacklist_patterns.length > 0) {
    return config.access.blacklist_patterns.some((p: string) => matchesPattern(name, p));
  }
  return false;
}

export function canAIActiveCheck(config: EnvCPConfig, clientId = ''): boolean {
  return getClientRule(config, clientId)?.allow_ai_active_check ?? config.access.allow_ai_active_check === true;
}

export function requiresUserReference(config: EnvCPConfig): boolean {
  return config.access.require_user_reference === true;
}
