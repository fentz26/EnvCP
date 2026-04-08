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
  password: {
    min_length: 1,
    require_complexity: false,
    allow_numeric_only: true,
    allow_single_char: true,
  },
};

export async function loadConfig(projectPath: string): Promise<EnvCPConfig> {
  const configPath = path.join(projectPath, 'envcp.yaml');
  
  if (await fs.pathExists(configPath)) {
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = yaml.load(content);
    const config = EnvCPConfigSchema.parse(parsed);
    return config;
  }
  
  return EnvCPConfigSchema.parse(DEFAULT_CONFIG);
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

export function getMcpConfigPaths(): { name: string; path: string }[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const platform = process.platform;
  const paths: { name: string; path: string }[] = [];

  // Claude Desktop
  if (platform === 'darwin') {
    paths.push({ name: 'Claude Desktop', path: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') });
  } else if (platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    paths.push({ name: 'Claude Desktop', path: path.join(appdata, 'Claude', 'claude_desktop_config.json') });
  } else {
    paths.push({ name: 'Claude Desktop', path: path.join(home, '.config', 'Claude', 'claude_desktop_config.json') });
  }

  // Cursor (global)
  paths.push({ name: 'Cursor', path: path.join(home, '.cursor', 'mcp.json') });

  // Claude Code (global)
  paths.push({ name: 'Claude Code', path: path.join(home, '.claude', 'mcp.json') });

  return paths;
}

export async function registerMcpConfig(projectPath: string): Promise<string[]> {
  const configs = getMcpConfigPaths();
  const registered: string[] = [];

  for (const { name, path: configPath } of configs) {
    if (!await fs.pathExists(configPath)) continue;

    try {
      const content = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(content);

      // Ensure mcpServers key exists
      if (!config.mcpServers) config.mcpServers = {};

      // Skip if already registered
      if (config.mcpServers.envcp) {
        registered.push(`${name} (already configured)`);
        continue;
      }

      config.mcpServers.envcp = {
        command: 'npx',
        args: ['envcp', 'serve', '--mode', 'mcp'],
        cwd: projectPath,
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      registered.push(name);
    } catch {
      // Skip invalid JSON or permission errors
    }
  }

  return registered;
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
