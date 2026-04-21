import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ensureDir, pathExists } from '../utils/fs.js';
import { EnvCPConfig } from '../types.js';

const ACTIVE_VAULT_FILE = '.envcp/.active-vault';
const NAMED_VAULTS_DIR = '.envcp/vaults';

export function getGlobalVaultPath(config: EnvCPConfig): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, config.vault.global_path);
}

export function getProjectVaultPath(projectPath: string, config: EnvCPConfig): string {
  return path.join(projectPath, config.storage.path);
}

export function getEffectiveVaultMode(config: EnvCPConfig): 'project' | 'global' {
  return config.vault?.mode ?? config.vault?.default ?? 'project';
}

export function resolveSessionPath(projectPath: string, config: EnvCPConfig): string {
  /* c8 ignore next -- Zod always provides session.path default; || fallback unreachable */
  const sessionRel = config.session?.path || '.envcp/.session';
  if (getEffectiveVaultMode(config) === 'global') {
    /* c8 ignore next */
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, sessionRel);
  }
  return path.join(projectPath, sessionRel);
}

export async function resolveVaultPath(projectPath: string, config: EnvCPConfig): Promise<string> {
  const activeVault = await getActiveVault(projectPath);
  if (activeVault) {
    if (activeVault === 'global') {
      return getGlobalVaultPath(config);
    }
    if (activeVault === 'project') {
      return getProjectVaultPath(projectPath, config);
    }
    const namedDir = path.join(projectPath, NAMED_VAULTS_DIR, activeVault);
    if (await pathExists(namedDir)) {
      return path.join(namedDir, 'store.enc');
    }
  }
  if (getEffectiveVaultMode(config) === 'global') {
    return getGlobalVaultPath(config);
  }
  return getProjectVaultPath(projectPath, config);
}

export async function getActiveVault(projectPath: string): Promise<string | null> {
  const activeFile = path.join(projectPath, ACTIVE_VAULT_FILE);
  try {
    const content = await fs.readFile(activeFile, 'utf8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

export async function setActiveVault(projectPath: string, vaultName: string): Promise<void> {
  const activeFile = path.join(projectPath, ACTIVE_VAULT_FILE);
  await ensureDir(path.dirname(activeFile));
  await fs.writeFile(activeFile, vaultName, 'utf8');
}

export async function listVaults(projectPath: string, config: EnvCPConfig): Promise<{ name: string; path: string; active: boolean }[]> {
  const vaults: { name: string; path: string; active: boolean }[] = [];
  const activeVault = await getActiveVault(projectPath);
  const effectiveActive = activeVault || config.vault.default;

  vaults.push({
    name: 'project',
    path: getProjectVaultPath(projectPath, config),
    active: effectiveActive === 'project',
  });

  const globalPath = getGlobalVaultPath(config);
  vaults.push({
    name: 'global',
    path: globalPath,
    active: effectiveActive === 'global',
  });

  const namedDir = path.join(projectPath, NAMED_VAULTS_DIR);
  if (await pathExists(namedDir)) {
    const entries = await fs.readdir(namedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        vaults.push({
          name: entry.name,
          path: path.join(namedDir, entry.name, 'store.enc'),
          active: effectiveActive === entry.name,
        });
      }
    }
  }

  return vaults;
}

export async function initNamedVault(projectPath: string, name: string): Promise<string> {
  if (name === 'project' || name === 'global') {
    throw new Error(`Vault name "${name}" is reserved`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error('Vault name must contain only letters, numbers, hyphens, and underscores');
  }
  const vaultDir = path.join(projectPath, NAMED_VAULTS_DIR, name);
  await ensureDir(vaultDir);
  return path.join(vaultDir, 'store.enc');
}
