import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, saveConfig, initConfig, canAIActiveCheck, requiresUserReference, registerMcpConfig } from '../src/config/manager';
import { EnvCPConfigSchema } from '../src/types';

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-'));
  });

  afterEach(async () => {
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

describe('saveConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cfg-'));
  });

  afterEach(async () => {
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

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-init-'));
  });

  afterEach(async () => {
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

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-mcp-reg-'));
  });

  afterEach(async () => {
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
