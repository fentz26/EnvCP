import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, loadScopedConfig, saveScopedConfig, saveConfig, initConfig, canAIActiveCheck, requiresUserReference, registerMcpConfig, unregisterMcpConfig, canAccessVariable, requiresConfirmationForVariable, isVariableRuleActive, canAccess, parseEnvFile, validateVariableName, resolveAccessRuleFlag, isBlacklisted } from '../src/config/manager';
import { EnvCPConfigSchema } from '../src/types';

describe('loadConfig', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no config exists', async () => {
    const config = await loadConfig(tmpDir);
    expect(config.version).toBe('1.0');
    expect(config.storage.encrypted).toBe(true);
    expect(config.access.allow_ai_read).toBe(false);
  });

  it('loads project config from envcp.yaml', async () => {
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');
    const config = await loadConfig(tmpDir);
    expect(config.access.allow_ai_read).toBe(true);
    // Defaults should still be present
    expect(config.storage.encrypted).toBe(true);
  });

  it('merges global and project configs', async () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const globalDir = path.join(home, '.envcp');
    const globalPath = path.join(globalDir, 'config.yaml');
    const hadGlobal = await pathExists(globalPath);
    let originalContent: string | undefined;

    if (hadGlobal) {
      originalContent = await fs.readFile(globalPath, 'utf8');
    }

    try {
      await ensureDir(globalDir);
      await fs.writeFile(globalPath, 'access:\n  allow_ai_read: true\n  mask_values: false\n');
      // Project overrides mask_values
      await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  mask_values: true\n');

      const config = await loadConfig(tmpDir);
      expect(config.access.allow_ai_read).toBe(true); // from global
      expect(config.access.mask_values).toBe(true); // project overrides
    } finally {
      if (hadGlobal && originalContent !== undefined) {
        await fs.writeFile(globalPath, originalContent);
      } else if (!hadGlobal) {
        await fs.rm(globalPath, { recursive: true, force: true });
      }
    }
  });
});

describe('scoped config load/save', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-scope-cfg-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads project-only rules without home overlay', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await ensureDir(projectDir);
    await fs.writeFile(path.join(projectDir, 'envcp.yaml'), 'access:\n  variable_rules:\n    PROJECT_KEY:\n      allow_ai_read: true\n');
    await ensureDir(path.join(tmpDir, '.envcp'));
    await fs.writeFile(path.join(tmpDir, '.envcp', 'config.yaml'), 'access:\n  variable_rules:\n    HOME_KEY:\n      allow_ai_read: true\n');

    const projectConfig = await loadScopedConfig(projectDir, 'project');
    expect(projectConfig.access.variable_rules.PROJECT_KEY).toBeDefined();
    expect(projectConfig.access.variable_rules.HOME_KEY).toBeUndefined();
  });

  it('loads merged scope by combining home and project config', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await ensureDir(projectDir);
    await ensureDir(path.join(tmpDir, '.envcp'));
    await fs.writeFile(path.join(tmpDir, '.envcp', 'config.yaml'), 'access:\n  allow_ai_read: true\n');
    await fs.writeFile(path.join(projectDir, 'envcp.yaml'), 'access:\n  mask_values: false\n');

    const mergedConfig = await loadScopedConfig(projectDir, 'merged');
    expect(mergedConfig.access.allow_ai_read).toBe(true);
    expect(mergedConfig.access.mask_values).toBe(false);
  });

  it('loads home scope with stored global config values', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await ensureDir(projectDir);
    await ensureDir(path.join(tmpDir, '.envcp'));
    await fs.writeFile(path.join(tmpDir, '.envcp', 'config.yaml'), 'access:\n  require_confirmation: false\n');

    const homeConfig = await loadScopedConfig(projectDir, 'home');
    expect(homeConfig.access.require_confirmation).toBe(false);
  });

  it('saves home scope rules into ~/.envcp/config.yaml', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await ensureDir(projectDir);
    const config = await loadScopedConfig(projectDir, 'home');
    config.access.variable_rules.HOME_KEY = { allow_ai_read: true };
    await saveScopedConfig(config, projectDir, 'home');

    const homeConfig = await fs.readFile(path.join(tmpDir, '.envcp', 'config.yaml'), 'utf8');
    expect(homeConfig).toContain('HOME_KEY');
  });

  it('saves project scope rules into envcp.yaml', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await ensureDir(projectDir);
    const config = await loadScopedConfig(projectDir, 'project');
    config.access.variable_rules.PROJECT_KEY = { allow_ai_read: true };
    await saveScopedConfig(config, projectDir, 'project');

    const projectConfig = await fs.readFile(path.join(projectDir, 'envcp.yaml'), 'utf8');
    expect(projectConfig).toContain('PROJECT_KEY');
  });
});

describe('saveConfig', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes config to envcp.yaml', async () => {
    const config = EnvCPConfigSchema.parse({});
    await saveConfig(config, tmpDir);
    const content = await fs.readFile(path.join(tmpDir, 'envcp.yaml'), 'utf8');
    expect(content).toContain('version:');
  });
});

describe('initConfig', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .envcp directory and config', async () => {
    const config = await initConfig(tmpDir, 'test-project');
    expect(config.project).toBe('test-project');
    expect(await pathExists(path.join(tmpDir, '.envcp'))).toBe(true);
    expect(await pathExists(path.join(tmpDir, '.envcp', 'logs'))).toBe(true);
    expect(await pathExists(path.join(tmpDir, 'envcp.yaml'))).toBe(true);
  });

  it('creates .gitignore if it does not exist', async () => {
    await initConfig(tmpDir);
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.envcp/');
  });

  it('appends to existing .gitignore', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
    await initConfig(tmpDir);
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('.envcp/');
  });

  it('does not duplicate .envcp/ in existing .gitignore', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '.envcp/\n');
    await initConfig(tmpDir);
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    const matches = gitignore.match(/\.envcp\//g);
    expect(matches!.length).toBe(1);
  });

  it('uses directory basename when no project name given', async () => {
    const config = await initConfig(tmpDir);
    expect(config.project).toBe(path.basename(tmpDir));
  });
});

describe('registerMcpConfig', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registers to project-local .vscode/mcp.json when .vscode exists', async () => {
    await ensureDir(path.join(tmpDir, '.vscode'));
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('VS Code');
    const content = await fs.readFile(path.join(tmpDir, '.vscode', 'mcp.json'), 'utf8');
    const config = JSON.parse(content);
    expect(config.servers.envcp).toBeDefined();
  });

  it('registers to project-local .cursor/mcp.json when .cursor exists', async () => {
    await ensureDir(path.join(tmpDir, '.cursor'));
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('Cursor (project)');
    const content = await fs.readFile(path.join(tmpDir, '.cursor', 'mcp.json'), 'utf8');
    const config = JSON.parse(content);
    expect(config.mcpServers.envcp).toBeDefined();
  });

  it('registers to project-local .jb-mcp.json when .idea exists', async () => {
    await ensureDir(path.join(tmpDir, '.idea'));
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('JetBrains');
    const content = await fs.readFile(path.join(tmpDir, '.jb-mcp.json'), 'utf8');
    const config = JSON.parse(content);
    expect(config.mcpServers.envcp).toBeDefined();
  });

  it('skips project-local configs when directories do not exist', async () => {
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).not.toContain('VS Code');
    expect(result.registered).not.toContain('Cursor (project)');
    expect(result.registered).not.toContain('JetBrains');
  });

  it('reports already configured when envcp entry exists', async () => {
    await ensureDir(path.join(tmpDir, '.vscode'));
    await fs.writeFile(path.join(tmpDir, '.vscode', 'mcp.json'), JSON.stringify({ servers: { envcp: {} } }));
    const result = await registerMcpConfig(tmpDir);
    expect(result.alreadyConfigured).toContain('VS Code');
  });

  it('includes manual targets in result', async () => {
    const result = await registerMcpConfig(tmpDir);
    expect(result.manual.length).toBeGreaterThan(0);
    expect(result.manual.some(m => m.includes('Trae'))).toBe(true);
  });

  it('registers to Zed settings when file exists', async () => {
    const zedPath = path.join(process.env.HOME || '', '.config', 'zed', 'settings.json');
    const hadZed = await pathExists(zedPath);
    let originalContent: string | undefined;

    if (hadZed) {
      originalContent = await fs.readFile(zedPath, 'utf8');
    }

    try {
      await ensureDir(path.dirname(zedPath));
      const existingConfig = hadZed ? JSON.parse(originalContent!) : {};
      // Remove envcp if present
      if (existingConfig.context_servers?.envcp) {
        delete existingConfig.context_servers.envcp;
      }
      await fs.writeFile(zedPath, JSON.stringify(existingConfig));

      const result = await registerMcpConfig(tmpDir);
      // Zed should be registered or already configured
      const zedRegistered = result.registered.includes('Zed') || result.alreadyConfigured.includes('Zed');
      expect(zedRegistered).toBe(true);
    } finally {
      if (hadZed && originalContent) {
        await fs.writeFile(zedPath, originalContent);
      } else if (!hadZed) {
        await fs.rm(zedPath, { recursive: true, force: true });
      }
    }
  });

  it('registers to OpenCode config when file exists', async () => {
    const opencodePath = path.join(process.env.HOME || '', '.config', 'opencode', 'opencode.json');
    const hadOpenCode = await pathExists(opencodePath);
    let originalContent: string | undefined;

    if (hadOpenCode) {
      originalContent = await fs.readFile(opencodePath, 'utf8');
    }

    try {
      await ensureDir(path.dirname(opencodePath));
      const existingConfig = hadOpenCode ? JSON.parse(originalContent!) : {};
      // Remove envcp if present
      if (existingConfig.mcp?.envcp) {
        delete existingConfig.mcp.envcp;
      }
      await fs.writeFile(opencodePath, JSON.stringify(existingConfig));

      const result = await registerMcpConfig(tmpDir);
      const registered = result.registered.includes('OpenCode') || result.alreadyConfigured.includes('OpenCode');
      expect(registered).toBe(true);
    } finally {
      if (hadOpenCode && originalContent) {
        await fs.writeFile(opencodePath, originalContent);
      } else if (!hadOpenCode) {
        await fs.rm(opencodePath, { recursive: true, force: true });
      }
    }
  });

  it('registers to GitHub Copilot CLI config when file exists', async () => {
    const copilotPath = path.join(process.env.HOME || '', '.copilot', 'mcp-config.json');
    const hadCopilot = await pathExists(copilotPath);
    let originalContent: string | undefined;

    if (hadCopilot) {
      originalContent = await fs.readFile(copilotPath, 'utf8');
    }

    try {
      await ensureDir(path.dirname(copilotPath));
      const existingConfig = hadCopilot ? JSON.parse(originalContent!) : {};
      // Remove envcp if present
      if (existingConfig.mcp_servers) {
        existingConfig.mcp_servers = (existingConfig.mcp_servers as any[]).filter((s: any) => s.name !== 'envcp');
      }
      await fs.writeFile(copilotPath, JSON.stringify(existingConfig));

      const result = await registerMcpConfig(tmpDir);
      const registered = result.registered.includes('GitHub Copilot CLI') || result.alreadyConfigured.includes('GitHub Copilot CLI');
      expect(registered).toBe(true);
    } finally {
      if (hadCopilot && originalContent) {
        await fs.writeFile(copilotPath, originalContent);
      } else if (!hadCopilot) {
        await fs.rm(copilotPath, { recursive: true, force: true });
      }
    }
  });

  it('handles invalid JSON in existing config gracefully', async () => {
    await ensureDir(path.join(tmpDir, '.vscode'));
    await fs.writeFile(path.join(tmpDir, '.vscode', 'mcp.json'), 'not-json');
    // Should not throw
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).not.toContain('VS Code');
  });

  it('updates existing Google AntiGravity config if file exists', async () => {
    await fs.writeFile(path.join(tmpDir, 'mcp_config.json'), JSON.stringify({ mcpServers: {} }));
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('Google AntiGravity');
  });

  it('skips Google AntiGravity when no existing file', async () => {
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).not.toContain('Google AntiGravity');
  });

  it('registers to OpenCode config (mcp_key format) when file exists', async () => {
    const opencodePath = path.join(tmpDir, '.config', 'opencode', 'opencode.json');
    await ensureDir(path.dirname(opencodePath));
    await fs.writeFile(opencodePath, JSON.stringify({}));
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('OpenCode');
    const content = JSON.parse(await fs.readFile(opencodePath, 'utf8'));
    expect(content.mcp.envcp.type).toBe('local');
  });

  it('marks OpenCode as already configured when envcp key exists', async () => {
    const opencodePath = path.join(tmpDir, '.config', 'opencode', 'opencode.json');
    await ensureDir(path.dirname(opencodePath));
    await fs.writeFile(opencodePath, JSON.stringify({ mcp: { envcp: { type: 'local' } } }));
    const result = await registerMcpConfig(tmpDir);
    expect(result.alreadyConfigured).toContain('OpenCode');
  });

  it('registers to GitHub Copilot CLI config (mcp_servers_array format) when file exists', async () => {
    const copilotPath = path.join(tmpDir, '.copilot', 'mcp-config.json');
    await ensureDir(path.dirname(copilotPath));
    await fs.writeFile(copilotPath, JSON.stringify({}));
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('GitHub Copilot CLI');
    const content = JSON.parse(await fs.readFile(copilotPath, 'utf8'));
    expect(content.mcp_servers.some((s: { name: string }) => s.name === 'envcp')).toBe(true);
  });

  it('marks GitHub Copilot CLI as already configured when envcp entry exists', async () => {
    const copilotPath = path.join(tmpDir, '.copilot', 'mcp-config.json');
    await ensureDir(path.dirname(copilotPath));
    await fs.writeFile(copilotPath, JSON.stringify({ mcp_servers: [{ name: 'envcp' }] }));
    const result = await registerMcpConfig(tmpDir);
    expect(result.alreadyConfigured).toContain('GitHub Copilot CLI');
  });

  it('registers Claude Code (mcpServers format) when ~/.claude/mcp.json exists', async () => {
    const claudePath = path.join(tmpDir, '.claude', 'mcp.json');
    await ensureDir(path.dirname(claudePath));
    await fs.writeFile(claudePath, JSON.stringify({}));
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('Claude Code');
    const content = JSON.parse(await fs.readFile(claudePath, 'utf8'));
    expect(content.mcpServers.envcp).toBeDefined();
  });

  it('registers Zed (context_servers format) when ~/.config/zed/settings.json exists', async () => {
    const zedPath = path.join(tmpDir, '.config', 'zed', 'settings.json');
    await ensureDir(path.dirname(zedPath));
    await fs.writeFile(zedPath, JSON.stringify({}));
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('Zed');
    const content = JSON.parse(await fs.readFile(zedPath, 'utf8'));
    expect((content.context_servers as Record<string, unknown>).envcp).toBeDefined();
  });

  it('marks Zed as already configured when context_servers.envcp exists', async () => {
    const zedPath = path.join(tmpDir, '.config', 'zed', 'settings.json');
    await ensureDir(path.dirname(zedPath));
    await fs.writeFile(zedPath, JSON.stringify({ context_servers: { envcp: {} } }));
    const result = await registerMcpConfig(tmpDir);
    expect(result.alreadyConfigured).toContain('Zed');
  });

  it('global config (~/.envcp/config.yaml) is merged into loadConfig', async () => {
    const globalDir = path.join(tmpDir, '.envcp');
    await ensureDir(globalDir);
    await fs.writeFile(path.join(globalDir, 'config.yaml'), 'access:\n  allow_ai_read: true\n');
    const { loadConfig } = await import('../src/config/manager.js');
    const config = await loadConfig(path.join(tmpDir, 'no-project'));
    expect(config.access.allow_ai_read).toBe(true);
  });
});

describe('canAIActiveCheck / requiresUserReference', () => {
  it('returns false when allow_ai_active_check is false', () => {
    const config = EnvCPConfigSchema.parse({ access: { allow_ai_active_check: false } });
    expect(canAIActiveCheck(config)).toBe(false);
  });

  it('returns true when allow_ai_active_check is true', () => {
    const config = EnvCPConfigSchema.parse({ access: { allow_ai_active_check: true } });
    expect(canAIActiveCheck(config)).toBe(true);
  });

  it('returns true when require_user_reference is true', () => {
    const config = EnvCPConfigSchema.parse({ access: { require_user_reference: true } });
    expect(requiresUserReference(config)).toBe(true);
  });

  it('returns false when require_user_reference is false', () => {
    const config = EnvCPConfigSchema.parse({ access: { require_user_reference: false } });
    expect(requiresUserReference(config)).toBe(false);
  });
});

describe('variable-specific access rules', () => {
  it('allows a variable-specific read override even when default read is off', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: false,
        variable_rules: {
          OPENAI_API_KEY: { allow_ai_read: true },
        },
      },
    });
    expect(canAccessVariable('OPENAI_API_KEY', config, 'read')).toBe(true);
  });

  it('denies a variable-specific execute override when explicitly set to false', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_execute: true,
        variable_rules: {
          DANGEROUS_TOKEN: { allow_ai_execute: false },
        },
      },
    });
    expect(canAccessVariable('DANGEROUS_TOKEN', config, 'execute')).toBe(false);
  });

  it('uses variable-specific confirmation override when present', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        require_confirmation: false,
        variable_rules: {
          PROD_KEY: { require_confirmation: true },
        },
      },
    });
    expect(requiresConfirmationForVariable('PROD_KEY', config)).toBe(true);
    expect(requiresConfirmationForVariable('OTHER_KEY', config)).toBe(false);
  });

  it('treats a daytime window as active only inside the range', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        variable_rules: {
          PROD_KEY: { active_window: { start: '09:00', end: '17:00' } },
        },
      },
    });
    expect(isVariableRuleActive('PROD_KEY', config, new Date('2024-01-01T10:30:00'))).toBe(true);
    expect(isVariableRuleActive('PROD_KEY', config, new Date('2024-01-01T18:00:00'))).toBe(false);
  });

  it('supports overnight windows', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        variable_rules: {
          NIGHT_KEY: { active_window: { start: '22:00', end: '06:00' } },
        },
      },
    });
    expect(isVariableRuleActive('NIGHT_KEY', config, new Date('2024-01-01T23:30:00'))).toBe(true);
    expect(isVariableRuleActive('NIGHT_KEY', config, new Date('2024-01-01T05:30:00'))).toBe(true);
    expect(isVariableRuleActive('NIGHT_KEY', config, new Date('2024-01-01T12:00:00'))).toBe(false);
  });

  it('uses who-specific default access overrides for a client', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: false,
        client_rules: {
          openai: { allow_ai_read: true },
        },
      },
    });
    expect(canAccessVariable('OPENAI_API_KEY', config, 'read')).toBe(false);
    expect(canAccessVariable('OPENAI_API_KEY', config, 'read', 'openai')).toBe(true);
  });

  it('rejects access when canAccess hits blacklist patterns directly', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        blacklist_patterns: ['SECRET_*'],
      },
    });
    expect(canAccess('SECRET_TOKEN', config)).toBe(false);
    expect(canAccess('PUBLIC_TOKEN', config)).toBe(true);
  });

  it('uses who-specific variable overrides ahead of global ones', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: false,
        variable_rules: {
          PROD_KEY: { allow_ai_read: true },
        },
        client_rules: {
          openai: {
            variable_rules: {
              PROD_KEY: { allow_ai_read: false },
            },
          },
        },
      },
    });
    expect(canAccessVariable('PROD_KEY', config, 'read')).toBe(true);
    expect(canAccessVariable('PROD_KEY', config, 'read', 'openai')).toBe(false);
  });

  it('uses who-specific confirmation and list-name overrides', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_active_check: false,
        require_confirmation: false,
        client_rules: {
          cursor: {
            allow_ai_active_check: true,
            require_confirmation: true,
            variable_rules: {
              FAST_KEY: { require_confirmation: false },
            },
          },
        },
      },
    });
    expect(canAIActiveCheck(config)).toBe(false);
    expect(canAIActiveCheck(config, 'cursor')).toBe(true);
    expect(requiresConfirmationForVariable('OTHER_KEY', config, 'cursor')).toBe(true);
    expect(requiresConfirmationForVariable('FAST_KEY', config, 'cursor')).toBe(false);
  });

  it('treats a window with matching start and end times as always active', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        variable_rules: {
          ALWAYS_ON: { active_window: { start: '09:00', end: '09:00' } },
        },
      },
    });
    expect(isVariableRuleActive('ALWAYS_ON', config, new Date('2024-01-01T03:00:00'))).toBe(true);
    expect(isVariableRuleActive('ALWAYS_ON', config, new Date('2024-01-01T18:00:00'))).toBe(true);
  });

  it('uses client-specific defaults for write delete export and execute', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_write: false,
        allow_ai_delete: false,
        allow_ai_export: false,
        allow_ai_execute: false,
        client_rules: {
          api: {
            allow_ai_write: true,
            allow_ai_delete: true,
            allow_ai_export: true,
            allow_ai_execute: true,
          },
        },
      },
    });
    expect(canAccessVariable('API_KEY', config, 'write', 'api')).toBe(true);
    expect(canAccessVariable('API_KEY', config, 'delete', 'api')).toBe(true);
    expect(canAccessVariable('API_KEY', config, 'export', 'api')).toBe(true);
    expect(canAccessVariable('API_KEY', config, 'execute', 'api')).toBe(true);
  });

  it('uses client-specific variable overrides for write delete export and execute', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_write: false,
        allow_ai_delete: false,
        allow_ai_export: false,
        allow_ai_execute: false,
        client_rules: {
          api: {
            variable_rules: {
              API_KEY: {
                allow_ai_write: true,
                allow_ai_delete: true,
                allow_ai_export: true,
                allow_ai_execute: true,
              },
            },
          },
        },
      },
    });
    expect(canAccessVariable('API_KEY', config, 'write', 'api')).toBe(true);
    expect(canAccessVariable('API_KEY', config, 'delete', 'api')).toBe(true);
    expect(canAccessVariable('API_KEY', config, 'export', 'api')).toBe(true);
    expect(canAccessVariable('API_KEY', config, 'execute', 'api')).toBe(true);
  });
});

describe('loadConfig — non-object YAML edge cases', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-nonobj-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('ignores global config when YAML parses to non-object (e.g. a number)', async () => {
    const globalDir = path.join(tmpDir, '.envcp');
    await ensureDir(globalDir);
    await fs.writeFile(path.join(globalDir, 'config.yaml'), '42\n');
    // Should not throw; falls back to defaults
    const config = await loadConfig(tmpDir);
    expect(config.version).toBe('1.0');
  });

  it('ignores project config when YAML parses to non-object (e.g. a string)', async () => {
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), '"just a string"\n');
    // Should not throw; falls back to defaults
    const config = await loadConfig(tmpDir);
    expect(config.version).toBe('1.0');
  });
});

describe('registerMcpConfig — platform-specific paths', () => {
  let tmpDir: string;
  let origHome: string | undefined;
  let origPlatform: PropertyDescriptor | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-platform-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses darwin-specific paths — line 166', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true, configurable: true });
    // Files don't exist on darwin paths, so nothing registers — but the darwin branch is evaluated
    const result = await registerMcpConfig(tmpDir);
    expect(Array.isArray(result.registered)).toBe(true);
  });

  it('uses win32-specific paths — lines 167, 190', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', writable: true, configurable: true });
    // Files don't exist on win32 paths, so nothing registers — but the win32 branches are evaluated
    const result = await registerMcpConfig(tmpDir);
    expect(Array.isArray(result.registered)).toBe(true);
  });

  it('uses USERPROFILE in registerMcpConfig when HOME is unset — line 289', async () => {
    delete process.env.HOME;
    process.env.USERPROFILE = tmpDir;
    try {
      const result = await registerMcpConfig(tmpDir);
      expect(Array.isArray(result.registered)).toBe(true);
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      delete process.env.USERPROFILE;
    }
  });
});

describe('loadConfig — USERPROFILE fallback', () => {
  let tmpDir: string;
  let origHome: string | undefined;
  let origUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-userprofile-'));
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    process.env.USERPROFILE = tmpDir;
  });

  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
    else delete process.env.USERPROFILE;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses USERPROFILE when HOME is unset', async () => {
    const globalDir = path.join(tmpDir, '.envcp');
    await ensureDir(globalDir);
    await fs.writeFile(path.join(globalDir, 'config.yaml'), 'access:\n  allow_ai_read: true\n');
    const config = await loadConfig(tmpDir);
    expect(config.access.allow_ai_read).toBe(true);
  });
});

describe('loadConfig — FAILSAFE_SCHEMA rejects !!js/ tags (issue #151)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-failsafe-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects !!js/regexp tag in project config — throws or uses defaults', async () => {
    const projectConfig = 'server:\n  api_key: !!js/regexp /evil/gi\n';
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), projectConfig);
    // FAILSAFE_SCHEMA does not support !!js/ types — should throw a YAMLException
    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });

  it('rejects !!js/undefined tag in global config — throws', async () => {
    const globalDir = path.join(tmpDir, '.envcp');
    await ensureDir(globalDir);
    await fs.writeFile(path.join(globalDir, 'config.yaml'), 'server:\n  host: !!js/undefined\n');
    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });

  it('still parses valid plain YAML after schema switch', async () => {
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');
    const config = await loadConfig(tmpDir);
    expect(config.access.allow_ai_read).toBe(true);
  });
});

describe('deepMerge — nested object recursion (line 88)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-deepmerge-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('deeply merges global and project configs (nested objects)', async () => {
    const globalDir = path.join(tmpDir, '.envcp');
    await ensureDir(globalDir);
    await fs.writeFile(path.join(globalDir, 'config.yaml'),
      'access:\n allow_ai_read: true\n allow_ai_write: false\n');
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'),
      'access:\n allow_ai_write: true\n');
    const config = await loadConfig(tmpDir);
    expect(config.access.allow_ai_read).toBe(true);
    expect(config.access.allow_ai_write).toBe(true);
  });

  it('replaces arrays (else branch in deepMerge)', async () => {
    const globalDir = path.join(tmpDir, '.envcp');
    await ensureDir(globalDir);
    await fs.writeFile(path.join(globalDir, 'config.yaml'),
      'access:\n blacklist_patterns:\n   - "*_SECRET"\n   - "*_PRIVATE"\n');
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'),
      'access:\n blacklist_patterns:\n   - "CUSTOM_*"\n');
    const config = await loadConfig(tmpDir);
    expect(config.access.blacklist_patterns).toEqual(['CUSTOM_*']);
  });

  it('replaces primitive values (else branch in deepMerge)', async () => {
    const globalDir = path.join(tmpDir, '.envcp');
    await ensureDir(globalDir);
    await fs.writeFile(path.join(globalDir, 'config.yaml'),
      'storage:\n encrypted: true\n');
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'),
      'storage:\n encrypted: false\n');
    const config = await loadConfig(tmpDir);
    expect(config.storage.encrypted).toBe(false);
});
});

describe('writeToConfig — alreadyExists path (line 257)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-already-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports alreadyConfigured when envcp already exists in mcpServers config', async () => {
    // Create a fake ~/.claude/mcp.json that already has envcp registered
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    const mcpPath = path.join(claudeDir, 'mcp.json');
    await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: { envcp: { command: 'npx' } } }));

    const result = await registerMcpConfig(tmpDir);
    expect(result.alreadyConfigured).toContain('Claude Code');
  });
});

describe('registerMcpConfig — write path (line 332)', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-regmcp-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes new mcp.json when Claude Code dir exists but file does not yet', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    await fs.writeFile(path.join(claudeDir, 'mcp.json'), JSON.stringify({}));

    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).toContain('Claude Code');
    const written = JSON.parse(await fs.readFile(path.join(claudeDir, 'mcp.json'), 'utf8'));
    expect(written.mcpServers?.envcp).toBeDefined();
  });

  it('catches and skips when config file has invalid JSON', async () => {
    await ensureDir(path.join(tmpDir, '.vscode'));
    await fs.writeFile(path.join(tmpDir, '.vscode', 'mcp.json'), 'not valid json {{{');
    const result = await registerMcpConfig(tmpDir);
    expect(result.registered).not.toContain('VS Code');
    expect(result.alreadyConfigured).not.toContain('VS Code');
  });
});

describe('writeToConfig — return value documentation (line 337)', () => {
  it('always returns written=true when alreadyExists=false (mcpServers format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({}, 'mcpServers', { command: 'npx' });
    expect(result.written).toBe(true);
    expect(result.alreadyExists).toBe(false);
  });

  it('always returns written=false when alreadyExists=true (mcpServers format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({ mcpServers: { envcp: {} } }, 'mcpServers', { command: 'npx' });
    expect(result.written).toBe(false);
    expect(result.alreadyExists).toBe(true);
  });

  it('always returns written=true when alreadyExists=false (servers format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({}, 'servers', { command: 'npx' });
    expect(result.written).toBe(true);
    expect(result.alreadyExists).toBe(false);
  });

  it('always returns written=false when alreadyExists=true (servers format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({ servers: { envcp: {} } }, 'servers', { command: 'npx' });
    expect(result.written).toBe(false);
    expect(result.alreadyExists).toBe(true);
  });

  it('always returns written=true when alreadyExists=false (context_servers format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({}, 'context_servers', { command: 'npx', args: [] });
    expect(result.written).toBe(true);
    expect(result.alreadyExists).toBe(false);
  });

  it('always returns written=false when alreadyExists=true (context_servers format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({ context_servers: { envcp: {} } }, 'context_servers', { command: 'npx', args: [] });
    expect(result.written).toBe(false);
    expect(result.alreadyExists).toBe(true);
  });

  it('always returns written=true when alreadyExists=false (mcp_key format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({}, 'mcp_key', {});
    expect(result.written).toBe(true);
    expect(result.alreadyExists).toBe(false);
  });

  it('always returns written=false when alreadyExists=true (mcp_key format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({ mcp: { envcp: {} } }, 'mcp_key', {});
    expect(result.written).toBe(false);
    expect(result.alreadyExists).toBe(true);
  });

  it('always returns written=true when alreadyExists=false (mcp_servers_array format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({}, 'mcp_servers_array', { command: 'npx' });
    expect(result.written).toBe(true);
    expect(result.alreadyExists).toBe(false);
  });

  it('always returns written=false when alreadyExists=true (mcp_servers_array format)', async () => {
    const { writeToConfig } = await import('../src/config/manager.js');
    const result = writeToConfig({ mcp_servers: [{ name: 'envcp' }] }, 'mcp_servers_array', { command: 'npx' });
    expect(result.written).toBe(false);
    expect(result.alreadyExists).toBe(true);
  });
});

describe('unregisterMcpConfig', () => {
  let tmpDir: string;
  let origHome: string | undefined;
  let origUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-unreg-'));
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
    else delete process.env.USERPROFILE;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes envcp from mcpServers-format config (Claude Code)', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    const mcpPath = path.join(claudeDir, 'mcp.json');
    await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: { envcp: { command: 'npx' }, other: { command: 'foo' } } }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.removed).toContain('Claude Code');
    const written = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
    expect(written.mcpServers.envcp).toBeUndefined();
    expect(written.mcpServers.other).toBeDefined();
  });

  it('removes envcp from servers-format config (VS Code)', async () => {
    const vscodeDir = path.join(tmpDir, '.vscode');
    await ensureDir(vscodeDir);
    const mcpPath = path.join(vscodeDir, 'mcp.json');
    await fs.writeFile(mcpPath, JSON.stringify({ servers: { envcp: { command: 'npx' } } }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.removed).toContain('VS Code');
    const written = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
    expect(written.servers.envcp).toBeUndefined();
  });

  it('removes envcp from context_servers-format config (Zed)', async () => {
    const zedPath = path.join(tmpDir, '.config', 'zed', 'settings.json');
    await ensureDir(path.dirname(zedPath));
    await fs.writeFile(zedPath, JSON.stringify({ context_servers: { envcp: { command: { path: 'npx' } } } }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.removed).toContain('Zed');
    const written = JSON.parse(await fs.readFile(zedPath, 'utf8'));
    expect(written.context_servers.envcp).toBeUndefined();
  });

  it('removes envcp from mcp_key-format config (OpenCode)', async () => {
    const opencodePath = path.join(tmpDir, '.config', 'opencode', 'opencode.json');
    await ensureDir(path.dirname(opencodePath));
    await fs.writeFile(opencodePath, JSON.stringify({ mcp: { envcp: { type: 'local' } } }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.removed).toContain('OpenCode');
    const written = JSON.parse(await fs.readFile(opencodePath, 'utf8'));
    expect(written.mcp.envcp).toBeUndefined();
  });

  it('removes envcp from mcp_servers_array-format config (GitHub Copilot CLI)', async () => {
    const copilotPath = path.join(tmpDir, '.copilot', 'mcp-config.json');
    await ensureDir(path.dirname(copilotPath));
    await fs.writeFile(copilotPath, JSON.stringify({ mcp_servers: [{ name: 'envcp' }, { name: 'other' }] }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.removed).toContain('GitHub Copilot CLI');
    const written = JSON.parse(await fs.readFile(copilotPath, 'utf8'));
    expect(written.mcp_servers).toEqual([{ name: 'other' }]);
  });

  it('reports notFound when config exists but has no envcp entry (mcpServers)', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    await fs.writeFile(path.join(claudeDir, 'mcp.json'), JSON.stringify({ mcpServers: { other: {} } }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.notFound).toContain('Claude Code');
    expect(result.removed).not.toContain('Claude Code');
  });

  it('reports notFound when array config exists but has no envcp entry', async () => {
    const copilotPath = path.join(tmpDir, '.copilot', 'mcp-config.json');
    await ensureDir(path.dirname(copilotPath));
    await fs.writeFile(copilotPath, JSON.stringify({ mcp_servers: [{ name: 'other' }] }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.notFound).toContain('GitHub Copilot CLI');
    expect(result.removed).not.toContain('GitHub Copilot CLI');
  });

  it('reports notFound when mcp_servers is missing entirely (array format)', async () => {
    const copilotPath = path.join(tmpDir, '.copilot', 'mcp-config.json');
    await ensureDir(path.dirname(copilotPath));
    await fs.writeFile(copilotPath, JSON.stringify({}));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.notFound).toContain('GitHub Copilot CLI');
  });

  it('reports notFound when mcpServers container is missing', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    await fs.writeFile(path.join(claudeDir, 'mcp.json'), JSON.stringify({}));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.notFound).toContain('Claude Code');
  });

  it('reports notFound when mcpServers container is null', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    await fs.writeFile(path.join(claudeDir, 'mcp.json'), JSON.stringify({ mcpServers: null }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.notFound).toContain('Claude Code');
  });

  it('reports notFound when mcpServers container is a string (non-object)', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    await fs.writeFile(path.join(claudeDir, 'mcp.json'), JSON.stringify({ mcpServers: 'not-an-object' }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.notFound).toContain('Claude Code');
  });

  it('reports notFound when mcpServers container is an array (Array.isArray check)', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    await fs.writeFile(path.join(claudeDir, 'mcp.json'), JSON.stringify({ mcpServers: ['x'] }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.notFound).toContain('Claude Code');
  });

  it('handles invalid JSON gracefully (caught in try/catch)', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    await fs.writeFile(path.join(claudeDir, 'mcp.json'), 'not valid json {{{');

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.removed).not.toContain('Claude Code');
    expect(result.notFound).not.toContain('Claude Code');
  });

  it('skips configs that do not exist', async () => {
    const result = await unregisterMcpConfig(tmpDir);
    // Nothing was set up — neither removed nor notFound for any target
    expect(result.removed).toEqual([]);
    expect(result.notFound).toEqual([]);
  });

  it('uses USERPROFILE when HOME is unset', async () => {
    delete process.env.HOME;
    process.env.USERPROFILE = tmpDir;
    const claudeDir = path.join(tmpDir, '.claude');
    await ensureDir(claudeDir);
    await fs.writeFile(path.join(claudeDir, 'mcp.json'), JSON.stringify({ mcpServers: { envcp: {} } }));

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.removed).toContain('Claude Code');
  });

  it('returns no removed entries when both HOME and USERPROFILE are unset', async () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    const result = await unregisterMcpConfig(tmpDir);
    expect(result.removed).toEqual([]);
  });
});

describe('verifyProjectConfigSignature — tampered config', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-sig-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when both sig file and config exist but HMAC does not match', async () => {
    // Create a config file
    await fs.writeFile(path.join(tmpDir, 'envcp.yaml'), 'access:\n  allow_ai_read: true\n');
    // Create the .envcp dir with a bad (wrong) signature
    const envcpDir = path.join(tmpDir, '.envcp');
    await ensureDir(envcpDir);
    await fs.writeFile(path.join(envcpDir, '.config_signature'), 'sha256:deadbeefdeadbeefdeadbeef00000000deadbeef00000000deadbeef00000000');

    await expect(loadConfig(tmpDir)).rejects.toThrow('Config integrity check failed');
  });
});

describe('initConfig — global option', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-globalinit-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sets vault mode to global when options.global is true', async () => {
    const config = await initConfig(tmpDir, 'global-project', { global: true });
    expect(config.vault.mode).toBe('global');
  });

  it('does not create .gitignore when global option is set', async () => {
    await initConfig(tmpDir, 'global-project', { global: true });
    const gitignoreExists = await pathExists(path.join(tmpDir, '.gitignore'));
    expect(gitignoreExists).toBe(false);
  });
});

describe('parseEnvFile', () => {
  it('parses simple KEY=value pairs', () => {
    const result = parseEnvFile('KEY=value\nOTHER=test');
    expect(result).toEqual({ KEY: 'value', OTHER: 'test' });
  });

  it('handles empty content', () => {
    const result = parseEnvFile('');
    expect(result).toEqual({});
  });

  it('ignores comment lines', () => {
    const result = parseEnvFile('# comment\nKEY=value');
    expect(result).toEqual({ KEY: 'value' });
  });

  it('handles double-quoted values', () => {
    const result = parseEnvFile('KEY="hello world"');
    expect(result).toEqual({ KEY: 'hello world' });
  });

  it('drops invalid POSIX variable names', () => {
    const result = parseEnvFile('123INVALID=value\nVALID=ok');
    expect(result).toEqual({ VALID: 'ok' });
  });
});

describe('validateVariableName', () => {
  it('returns true for valid variable names', () => {
    expect(validateVariableName('VALID_NAME')).toBe(true);
    expect(validateVariableName('_UNDERSCORE')).toBe(true);
    expect(validateVariableName('myVar123')).toBe(true);
  });

  it('returns false for names starting with a digit', () => {
    expect(validateVariableName('123invalid')).toBe(false);
  });

  it('returns false for names containing hyphens', () => {
    expect(validateVariableName('INVALID-NAME')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateVariableName('')).toBe(false);
  });
});

describe('isBlacklisted', () => {
  it('returns true when name matches a blacklist_patterns entry', () => {
    const config = EnvCPConfigSchema.parse({
      access: { blacklist_patterns: ['SECRET_*'] },
    });
    expect(isBlacklisted('SECRET_TOKEN', config)).toBe(true);
  });

  it('returns false when name does not match any blacklist_patterns entry', () => {
    const config = EnvCPConfigSchema.parse({
      access: { blacklist_patterns: ['SECRET_*'] },
    });
    expect(isBlacklisted('PUBLIC_TOKEN', config)).toBe(false);
  });

  it('returns false when blacklist_patterns is empty', () => {
    const config = EnvCPConfigSchema.parse({});
    expect(isBlacklisted('ANY_VAR', config)).toBe(false);
  });
});

describe('canAccess — denied_patterns and allowed_patterns', () => {
  it('returns false when name matches a denied_patterns entry', () => {
    const config = EnvCPConfigSchema.parse({
      access: { denied_patterns: ['PRIVATE_*'] },
    });
    expect(canAccess('PRIVATE_KEY', config)).toBe(false);
  });

  it('returns true when name does not match denied_patterns', () => {
    const config = EnvCPConfigSchema.parse({
      access: { denied_patterns: ['PRIVATE_*'] },
    });
    expect(canAccess('PUBLIC_KEY', config)).toBe(true);
  });

  it('returns false when allowed_patterns is set and name does not match', () => {
    const config = EnvCPConfigSchema.parse({
      access: { allowed_patterns: ['ALLOWED_*'] },
    });
    expect(canAccess('OTHER_KEY', config)).toBe(false);
  });

  it('returns true when name matches an allowed_patterns entry', () => {
    const config = EnvCPConfigSchema.parse({
      access: { allowed_patterns: ['ALLOWED_*'] },
    });
    expect(canAccess('ALLOWED_KEY', config)).toBe(true);
  });
});

describe('resolveAccessRuleFlag', () => {
  it('falls through to default access flag when no variable rule is set', () => {
    const config = EnvCPConfigSchema.parse({
      access: { allow_ai_read: true },
    });
    expect(resolveAccessRuleFlag('NO_RULE_VAR', config, 'read')).toBe(true);
  });

  it('returns variable rule flag when set (overrides default)', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: true,
        variable_rules: { SPECIFIC: { allow_ai_read: false } },
      },
    });
    expect(resolveAccessRuleFlag('SPECIFIC', config, 'read')).toBe(false);
  });

  it('uses client variable rule when clientId is provided', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: false,
        client_rules: {
          myClient: {
            variable_rules: { MY_VAR: { allow_ai_read: true } },
          },
        },
      },
    });
    expect(resolveAccessRuleFlag('MY_VAR', config, 'read', 'myClient')).toBe(true);
  });
});

describe('canAccessVariable — blacklist and inactive window branches', () => {
  it('returns false immediately when variable is blacklisted', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: true,
        blacklist_patterns: ['SECRET_*'],
      },
    });
    expect(canAccessVariable('SECRET_TOKEN', config, 'read')).toBe(false);
  });

  it('returns false when variable rule window is not active', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: true,
        variable_rules: {
          TIMED_KEY: { active_window: { start: '09:00', end: '10:00' } },
        },
      },
    });
    // Use a time outside the window (e.g. 18:00)
    const outside = new Date('2024-01-01T18:00:00');
    expect(isVariableRuleActive('TIMED_KEY', config, outside)).toBe(false);
    // Exercise the canAccessVariable inactive-window branch directly with an injected clock
    expect(canAccessVariable('TIMED_KEY', config, 'read', '', outside)).toBe(false);

    // Also verify with a distinct narrow-window config
    const config3 = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: true,
        variable_rules: {
          NIGHT_VAR: { active_window: { start: '00:00', end: '00:01' } },
        },
      },
    });
    expect(isVariableRuleActive('NIGHT_VAR', config3, outside)).toBe(false);
    expect(canAccessVariable('NIGHT_VAR', config3, 'read', '', outside)).toBe(false);
  });
});

describe('canAccessVariable inactive rule branch', () => {
  it('returns false when variable rule has an inactive time window', () => {
    // Build a config with a variable rule active only between 00:00 and 00:01
    // Then call canAccessVariable at a time outside that window
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: true,
        variable_rules: {
          NIGHT_VAR: { active_window: { start: '00:00', end: '00:01' } },
        },
      },
    });
    // Mock the current time to be inside an inactive period (18:00)
    const fixedDate = new Date('2025-01-01T18:00:00');
    const RealDate = Date;
    // @ts-expect-error - test override
    global.Date = class extends RealDate {
      constructor(...args: ConstructorParameters<typeof RealDate>) {
        if (args.length === 0) {
          super(fixedDate);
          return;
        }
        super(...args);
      }
    } as DateConstructor;
    try {
      expect(canAccessVariable('NIGHT_VAR', config, 'read')).toBe(false);
    } finally {
      global.Date = RealDate;
    }
  });
});

describe('getVariableRuleFlag and getDefaultAccessFlag operations', () => {
  it('returns variable rule flags for each operation when client rule is absent', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        variable_rules: {
          OP_VAR: {
            allow_ai_read: true,
            allow_ai_write: true,
            allow_ai_delete: true,
            allow_ai_export: true,
            allow_ai_execute: true,
          },
        },
      },
    });
    expect(resolveAccessRuleFlag('OP_VAR', config, 'read')).toBe(true);
    expect(resolveAccessRuleFlag('OP_VAR', config, 'write')).toBe(true);
    expect(resolveAccessRuleFlag('OP_VAR', config, 'delete')).toBe(true);
    expect(resolveAccessRuleFlag('OP_VAR', config, 'export')).toBe(true);
    expect(resolveAccessRuleFlag('OP_VAR', config, 'execute')).toBe(true);
  });

  it('falls back to defaults for each operation when no variable rule', () => {
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: true,
        allow_ai_write: true,
        allow_ai_delete: true,
        allow_ai_export: true,
        allow_ai_execute: true,
      },
    });
    expect(resolveAccessRuleFlag('NOPE', config, 'read')).toBe(true);
    expect(resolveAccessRuleFlag('NOPE', config, 'write')).toBe(true);
    expect(resolveAccessRuleFlag('NOPE', config, 'delete')).toBe(true);
    expect(resolveAccessRuleFlag('NOPE', config, 'export')).toBe(true);
    expect(resolveAccessRuleFlag('NOPE', config, 'execute')).toBe(true);
  });
});

describe('getHomeDir USERPROFILE fallback', () => {
  it('uses USERPROFILE when HOME is unset (covered indirectly via initConfig)', async () => {
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-userprofile-'));
    try {
      delete process.env.HOME;
      process.env.USERPROFILE = tmpDir;
      // Any code path that calls getHomeDir() will exercise the fallback.
      // loadConfig calls it internally to find the global config.
      const config = await loadConfig(tmpDir);
      expect(config).toBeDefined();
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
      else delete process.env.USERPROFILE;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls back to empty string when both HOME and USERPROFILE are unset', async () => {
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-nohome-'));
    try {
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      // loadConfig calls getHomeDir() which now falls back to ''
      // This should not throw; it just means no global config is found.
      const config = await loadConfig(tmpDir);
      expect(config).toBeDefined();
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome;
      if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

