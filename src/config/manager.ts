import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { EnvCPConfig, EnvCPConfigSchema } from '../types.js';

const DEFAULT_CONFIG: Partial<EnvCPConfig> = {
  version: '1.0',
  storage: {
    path: '.envcp/store.enc',
    encrypted: true,
    algorithm: 'aes-256-gcm',
    compression: false,
  },
  access: {
    allow_ai_read: false,
    allow_ai_write: false,
    allow_ai_delete: false,
    allow_ai_export: false,
    allow_ai_execute: false,
    allow_ai_active_check: false,
    require_user_reference: true,
    allowed_commands: undefined,
    require_confirmation: true,
    mask_values: true,
    audit_log: true,
    blacklist_patterns: ['*_SECRET', '*_PRIVATE', 'ADMIN_*', 'ROOT_*'],
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
  },
  encryption: {
    enabled: true,
  },
  security: {
    mode: 'recoverable',
    recovery_file: '.envcp/.recovery',
  },
  password: {
    min_length: 1,
    require_complexity: false,
    allow_numeric_only: true,
    allow_single_char: true,
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
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

export async function loadConfig(projectPath: string): Promise<EnvCPConfig> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const globalConfigPath = path.join(home, '.envcp', 'config.yaml');
  const projectConfigPath = path.join(projectPath, 'envcp.yaml');

  let merged: Record<string, unknown> = DEFAULT_CONFIG as Record<string, unknown>;

  // Layer 1: global config (~/.envcp/config.yaml)
  if (await fs.pathExists(globalConfigPath)) {
    const content = await fs.readFile(globalConfigPath, 'utf8');
    const parsed = yaml.load(content) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      merged = deepMerge(merged, parsed);
    }
  }

  // Layer 2: project config (envcp.yaml) — overrides global
  if (await fs.pathExists(projectConfigPath)) {
    const content = await fs.readFile(projectConfigPath, 'utf8');
    const parsed = yaml.load(content) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      merged = deepMerge(merged, parsed);
    }
  }

  return EnvCPConfigSchema.parse(merged);
}

export async function saveConfig(config: EnvCPConfig, projectPath: string): Promise<void> {
  const configPath = path.join(projectPath, 'envcp.yaml');
  const content = yaml.dump(config, { indent: 2, lineWidth: -1 });
  await fs.writeFile(configPath, content, 'utf8');
}

export async function initConfig(projectPath: string, projectName?: string): Promise<EnvCPConfig> {
  const envcpDir = path.join(projectPath, '.envcp');
  await fs.ensureDir(envcpDir);
  await fs.ensureDir(path.join(envcpDir, 'logs'));
  
  const config: EnvCPConfig = {
    ...DEFAULT_CONFIG,
    project: projectName || path.basename(projectPath),
  } as EnvCPConfig;
  
  await saveConfig(config, projectPath);
  
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (await fs.pathExists(gitignorePath)) {
    const gitignore = await fs.readFile(gitignorePath, 'utf8');
    if (!gitignore.includes('.envcp/')) {
      await fs.appendFile(gitignorePath, '\n# EnvCP\n.envcp/\nstore.enc\n');
    }
  } else {
    await fs.writeFile(gitignorePath, '# EnvCP\n.envcp/\nstore.enc\n');
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

function getMcpTargets(): McpTarget[] {
  return [
    // --- Global configs (require existing file = tool is installed) ---
    {
      name: 'Claude Desktop',
      getPath: (_proj, home, platform) => {
        if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        if (platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
        return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
      },
      projectLocal: false, requireExisting: true, format: 'mcpServers',
    },
    {
      name: 'Claude Code',
      getPath: (_proj, home) => path.join(home, '.claude', 'mcp.json'),
      projectLocal: false, requireExisting: true, format: 'mcpServers',
    },
    {
      name: 'Cursor',
      getPath: (_proj, home) => path.join(home, '.cursor', 'mcp.json'),
      projectLocal: false, requireExisting: true, format: 'mcpServers',
    },
    {
      name: 'Windsurf',
      getPath: (_proj, home) => path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      projectLocal: false, requireExisting: true, format: 'mcpServers',
    },
    {
      name: 'Zed',
      getPath: (_proj, home, platform) => {
        if (platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Zed', 'settings.json');
        return path.join(home, '.config', 'zed', 'settings.json');
      },
      projectLocal: false, requireExisting: true, format: 'context_servers',
    },
    {
      name: 'Continue.dev',
      getPath: (_proj, home) => path.join(home, '.continue', 'mcp.json'),
      projectLocal: false, requireExisting: true, format: 'mcpServers',
    },
    {
      name: 'OpenCode',
      getPath: (_proj, home) => path.join(home, '.config', 'opencode', 'opencode.json'),
      projectLocal: false, requireExisting: true, format: 'mcp_key',
    },
    {
      name: 'GitHub Copilot CLI',
      getPath: (_proj, home) => path.join(home, '.copilot', 'mcp-config.json'),
      projectLocal: false, requireExisting: true, format: 'mcp_servers_array',
    },
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

function writeToConfig(
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
      if (!await fs.pathExists(dirPath)) continue;
    }

    // For global configs that don't exist yet: skip (tool not installed)
    if (target.requireExisting && !await fs.pathExists(configPath)) continue;

    // For project-local Google AntiGravity: always skip creating the file fresh
    // (only update if it already exists, since we can't detect the tool)
    if (target.name === 'Google AntiGravity' && !await fs.pathExists(configPath)) continue;

    try {
      let config: Record<string, unknown> = {};
      if (await fs.pathExists(configPath)) {
        const content = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(content);
      }

      const entry = createMcpEntry(projectPath, target.projectLocal);
      const result = writeToConfig(config, target.format, entry);

      if (result.alreadyExists) {
        alreadyConfigured.push(target.name);
        continue;
      }

      if (result.written) {
        await fs.ensureDir(path.dirname(configPath));
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
        registered.push(target.name);
      }
    } catch {
      // Skip invalid JSON or permission errors
    }
  }

  return { registered, alreadyConfigured, manual };
}

export function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (validateVariableName(key)) {
      vars[key] = value;
    }
  }

  return vars;
}

export function validateVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function matchesPattern(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
  return regex.test(name);
}

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

export function isBlacklisted(name: string, config: EnvCPConfig): boolean {
  if (config.access.blacklist_patterns && config.access.blacklist_patterns.length > 0) {
    return config.access.blacklist_patterns.some((p: string) => matchesPattern(name, p));
  }
  return false;
}

export function canAIActiveCheck(config: EnvCPConfig): boolean {
  return config.access.allow_ai_active_check === true;
}

export function requiresUserReference(config: EnvCPConfig): boolean {
  return config.access.require_user_reference === true;
}
