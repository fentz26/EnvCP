import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { promptPassword, promptInput, promptConfirm, promptMenu, promptTabbedMenu, MenuTab } from '../utils/prompt.js';
import { ensureDir, pathExists, findProjectRoot } from '../utils/fs.js';
import { loadConfig, loadScopedConfig, initConfig, saveConfig, saveScopedConfig, parseEnvFile, registerMcpConfig, isBlacklisted, canAccess } from '../config/manager.js';
import { ConfigGuard } from '../config/config-guard.js';
import { StorageManager, LogManager, resolveLogPath } from '../storage/index.js';
import { VERSION } from '../version.js';
import { SessionManager } from '../utils/session.js';
import { maskValue, validatePassword, encrypt, decrypt, generateRecoveryKey, createRecoveryData, recoverPassword } from '../utils/crypto.js';
import { KeychainManager } from '../utils/keychain.js';
import { HsmManager } from '../utils/hsm.js';
import { checkForUpdate, formatUpdateMessage, logUpdateCheck, fetchReleases, filterByChannel, ReleaseChannel } from '../utils/update-checker.js';
import { spawnSync } from 'node:child_process';
import { LockoutManager } from '../utils/lockout.js';

import { Variable, EnvCPConfig } from '../types.js';
import { initMemoryProtection, secureCompare } from '../utils/secure-memory.js';
import {
  getGlobalVaultPath,
  getProjectVaultPath,
  resolveVaultPath,
  resolveSessionPath,
  setActiveVault,
  listVaults,
  initNamedVault,
} from '../vault/index.js';
import { loadServiceConfig, saveServiceConfig, ServiceConfig } from '../service/config.js';
import { installService, statusService, uninstallService } from '../service/index.js';

initMemoryProtection();

type VaultOverride = 'global' | 'project';
type HsmType = 'yubikey' | 'gpg' | 'pkcs11';

async function resolveCliContext(vaultOverride?: VaultOverride): Promise<{ projectPath: string; config: EnvCPConfig }> {
  if (vaultOverride === 'global') {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const config = await loadConfig(home);
    config.vault = { ...config.vault, mode: 'global' };
    return { projectPath: home, config };
  }
  const projectPath = process.cwd();
  const config = await loadConfig(projectPath);
  if (vaultOverride === 'project') {
    config.vault = { ...config.vault, mode: 'project' };
  }
  return { projectPath, config };
}

type SecurityChoice = 'none' | 'recoverable' | 'hard-lock';

function createEmptyNotifications(): {} {
  return Object.create(null) as {};
}

function buildSecuritySettings(securityChoice: SecurityChoice): {
  encryption: EnvCPConfig['encryption'];
  storageEncrypted: boolean;
  security: EnvCPConfig['security'];
} {
  const bruteForceProtection = {
    enabled: true,
    max_attempts: 5,
    lockout_duration: 300,
    progressive_delay: true,
    max_delay: 60,
    permanent_lockout_threshold: 50,
    permanent_lockout_action: 'require_recovery_key' as const,
      notifications: createEmptyNotifications(),
  };

  if (securityChoice === 'none') {
    return {
      encryption: { enabled: false },
      storageEncrypted: false,
      security: {
        mode: 'recoverable',
        recovery_file: '.envcp/.recovery',
        brute_force_protection: bruteForceProtection,
      },
    };
  }

  return {
    encryption: { enabled: true },
    storageEncrypted: true,
    security: {
      mode: securityChoice,
      recovery_file: '.envcp/.recovery',
      brute_force_protection: bruteForceProtection,
    },
  };
}

type TransferMeta = {
  project?: string;
  timestamp?: string;
  count?: number;
};

function extractTransferVariables(
  data: Record<string, unknown>,
  invalidMessage: string,
): { meta?: TransferMeta; variables: Record<string, Variable> } | null {
  const variables = data.variables;
  if (!variables || typeof variables !== 'object') {
    console.log(chalk.red(invalidMessage));
    return null;
  }

  return {
    meta: data.meta as TransferMeta | undefined,
    variables: variables as Record<string, Variable>,
  };
}

function logTransferInfo(
  title: string,
  meta: TransferMeta | undefined,
  variables: Record<string, Variable>,
  labels: { project: string; timestamp: string },
): void {
  if (!meta) {
    return;
  }

  console.log(chalk.blue(title));
  if (meta.project) console.log(chalk.gray(`  ${labels.project}: ${meta.project}`));
  if (meta.timestamp) console.log(chalk.gray(`  ${labels.timestamp}: ${meta.timestamp}`));
  console.log(chalk.gray(`  Variables: ${meta.count || Object.keys(variables).length}`));
}

function formatEnvAssignmentValue(value: string): string {
  if (!/[\s#"'\\]/.test(value)) {
    return value;
  }

  const escapedValue = value.replaceAll(/["\\]/g, String.raw`\$&`);
  return `"${escapedValue}"`;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`).replaceAll('*', '.*');
  const source = `^${escaped}$`;
  // eslint-disable-next-line security/detect-non-literal-regexp -- glob pattern from config; metacharacters escaped above
  return new RegExp(source);
}

async function getKeychainPassword(projectPath: string, serviceName?: string, multiFactor = false): Promise<string> {
  const keychain = new KeychainManager(serviceName || 'envcp');
  const stored = await keychain.retrievePassword(projectPath);
  if (stored) {
    const label = multiFactor ? 'Password retrieved from OS keychain (multi-factor)' : 'Password retrieved from OS keychain';
    console.log(chalk.gray(label));
    return stored;
  }
  return '';
}

async function getMultiFactorPassword(
  projectPath: string,
  config: EnvCPConfig,
  backendName: string,
): Promise<string> {
  const factors = config.auth?.multi_factors ?? ['password', 'hsm'];
  let userPassword = '';

  if (factors.includes('password')) {
    userPassword = await promptPassword('Enter password (multi-factor):');
  } else if (factors.includes('keychain')) {
    userPassword = await getKeychainPassword(projectPath, config.keychain?.service, true);
  }

  console.log(chalk.gray(`Authenticated via ${backendName} + password`));
  return userPassword;
}

async function tryHsmAuthentication(projectPath: string, config: EnvCPConfig, authMethod: string): Promise<string | null> {
  const hsm = HsmManager.fromConfig(config, projectPath);
  const fallback = config.auth?.fallback ?? 'password';
  const hsmAvailable = await hsm.isAvailable();

  if (!hsmAvailable) {
    if (fallback === 'none') {
      console.log(chalk.red(`HSM device (${hsm.backendName}) not found. No fallback configured.`));
      return null;
    }
    console.log(chalk.yellow(`HSM device (${hsm.backendName}) not available. Falling back to password...`));
    return '';
  }

  try {
    const hsmSecret = await hsm.retrieveVaultPassword();
    if (authMethod === 'multi') {
      const userPassword = await getMultiFactorPassword(projectPath, config, hsm.backendName);
      return HsmManager.combineSecrets(hsmSecret, userPassword);
    }

    console.log(chalk.gray(`Authenticated via ${hsm.backendName}`));
    return hsmSecret;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (fallback === 'none') {
      console.log(chalk.red(`HSM authentication failed: ${message}`));
      return null;
    }
    console.log(chalk.yellow(`HSM unavailable: ${message}`));
    console.log(chalk.gray('Falling back to password...'));
    return '';
  }
}

async function getAuthPassword(projectPath: string, config: EnvCPConfig): Promise<string | null> {
  let password = '';
  const authMethod = config.auth?.method ?? 'password';

  if (authMethod === 'hsm' || authMethod === 'multi') {
    const hsmPassword = await tryHsmAuthentication(projectPath, config, authMethod);
    if (hsmPassword === null) {
      return null;
    }
    password = hsmPassword;
  }

  if (!password && (authMethod === 'keychain' || config.keychain?.enabled)) {
    password = await getKeychainPassword(projectPath, config.keychain?.service);
  }

  if (!password) {
    password = await promptPassword('Enter password:');
    const { valid: passwordValid, warning: passwordWarning } = validatePassword(password, config.password || {});
    if (!passwordValid) {
      console.log(chalk.red('Invalid password'));
      return null;
    }
    if (passwordWarning) {
      console.log(chalk.yellow('⚠ Weak password detected'));
    }
  }

  return password;
}

async function resolveSecurityChoice(options: {
  encrypt?: boolean;
}, initMode: string): Promise<SecurityChoice> {
  if (options.encrypt === false) {
    return 'none';
  }
  if (initMode !== 'basic') {
    return chooseSecurityMode();
  }
  if (!isInteractiveCli()) {
    return 'recoverable';
  }
  return (await promptConfirm('Protect variables with encryption?', true)) ? 'recoverable' : 'none';
}

async function configureInitModeSettings(
  config: EnvCPConfig,
  initMode: string,
  securityChoice: SecurityChoice,
): Promise<void> {
  const sessionPrompt = initMode === 'advanced'
    ? 'Keep an unlocked session between commands?'
    : 'Enable sessions?';
  const confirmationPrompt = initMode === 'advanced'
    ? 'Ask before risky AI actions?'
    : 'Require confirmation for risky AI actions?';

  if (initMode === 'basic') {
    config.session.enabled = false;
    config.access.require_confirmation = false;
    return;
  }

  config.session.enabled = securityChoice !== 'none'
    && (!isInteractiveCli() || await promptConfirm(sessionPrompt, true));
  config.access.require_confirmation = !isInteractiveCli() || await promptConfirm(confirmationPrompt, true);
}

async function promptEncryptionPassword(securityChoice: SecurityChoice): Promise<string> {
  if (securityChoice === 'none') {
    return '';
  }

  const password = await promptPassword('Set encryption password:');
  const confirmPwd = await promptPassword('Confirm password:');
  if (!secureCompare(Buffer.from(password, 'utf8'), Buffer.from(confirmPwd, 'utf8'))) {
    console.log(chalk.red('Passwords do not match. Aborting.'));
    return '';
  }
  return password;
}

async function maybeWriteRecoveryKey(
  securityChoice: SecurityChoice,
  password: string,
  projectPath: string,
  config: EnvCPConfig,
): Promise<void> {
  if (securityChoice !== 'recoverable' || !password) {
    return;
  }

  const recoveryKey = generateRecoveryKey();
  const recoveryData = await createRecoveryData(password, recoveryKey);
  const recoveryPath = path.join(projectPath, config.security.recovery_file);
  await fs.writeFile(recoveryPath, recoveryData, 'utf8');

  console.log('');
  console.log(chalk.yellow.bold('  RECOVERY KEY (save this somewhere safe!):'));
  console.log(chalk.yellow.bold(`  ${recoveryKey}`));
  console.log(chalk.gray('  This key is shown ONCE. If you lose it, you cannot recover your password.'));
}

function logMcpRegistration(result: Awaited<ReturnType<typeof registerMcpConfig>>): void {
  console.log('');
  if (result.registered.length > 0) {
    console.log(chalk.green('  MCP registered:'));
    for (const name of result.registered) {
      console.log(chalk.gray(`    + ${name}`));
    }
    return;
  }

  if (result.alreadyConfigured.length === 0) {
    console.log(chalk.gray('  No AI tools detected for auto-registration'));
  }
}

async function maybeConfigureHsmAuth(
  config: EnvCPConfig,
  password: string,
  projectPath: string,
  options: {
    authMethod?: string;
    hsmType?: HsmType;
    keyId?: string;
    pkcs11Lib?: string;
  },
): Promise<void> {
  const authMethod = options.authMethod;
  if (!password || (authMethod !== 'hsm' && authMethod !== 'multi')) {
    return;
  }

  const hsmType = options.hsmType || 'yubikey';
  config.hsm = {
    ...config.hsm,
    enabled: true,
    type: hsmType,
    key_id: options.keyId ?? config.hsm?.key_id,
    pkcs11_lib: options.pkcs11Lib ?? config.hsm?.pkcs11_lib,
    require_touch: config.hsm?.require_touch ?? true,
    protected_key_path: config.hsm?.protected_key_path ?? '.envcp/.hsm-key',
  };
  config.auth = {
    method: authMethod,
    multi_factors: authMethod === 'multi' ? ['password', 'hsm'] : ['hsm'],
    fallback: 'password',
  };
  await saveConfig(config, projectPath);
}

async function withSession(fn: (storage: StorageManager, password: string, config: EnvCPConfig, projectPath: string, logManager: LogManager) => Promise<void>, vaultOverride?: VaultOverride): Promise<void> {
  const { projectPath, config } = await resolveCliContext(vaultOverride);

  let vaultPath: string;
  if (!vaultOverride) {
    vaultPath = await resolveVaultPath(projectPath, config);
  } else if (vaultOverride === 'global') {
    vaultPath = getGlobalVaultPath(config);
  } else {
    vaultPath = getProjectVaultPath(projectPath, config);
  }

  const logManager = new LogManager(resolveLogPath(config.audit, projectPath), config.audit);
  await logManager.init();

  if (config.encryption?.enabled === false) {
    const storage = new StorageManager(vaultPath, false);
    await fn(storage, '', config, projectPath, logManager);
    return;
  }

  const sessionManager = new SessionManager(
    resolveSessionPath(projectPath, config),
    config.session?.timeout_minutes || 30,
    config.session?.max_extensions || 5,
  );
  await sessionManager.init();

  let password = '';

  if (config.session?.enabled === false) {
    const authPassword = await getAuthPassword(projectPath, config);
    if (!authPassword) {
      return;
    }
    password = authPassword;
    await sessionManager.destroy();
  } else {
    const session = await sessionManager.load();
    if (!session) {
      const authPassword = await getAuthPassword(projectPath, config);
      if (!authPassword) {
        return;
      }
      password = authPassword;
      await sessionManager.create(password);
    }
    password = sessionManager.getPassword() || password;
  }

  const storage = new StorageManager(vaultPath, config.storage.encrypted);
  if (password) storage.setPassword(password);

  await fn(storage, password, config, projectPath, logManager);
}

type InitMode = 'basic' | 'advanced' | 'manual';

function isInteractiveCli(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function isProjectInitialized(projectPath: string = process.cwd()): Promise<boolean> {
  return pathExists(path.join(projectPath, 'envcp.yaml'));
}

async function chooseInitMode(): Promise<InitMode> {
  if (!isInteractiveCli()) {
    return 'basic';
  }
  return promptMenu('Set up EnvCP', [
    { label: 'Basic', value: 'basic', hint: '(quick, simple, low-tech)' },
    { label: 'Advanced', value: 'advanced', hint: '(guided, more choices)' },
    { label: 'Manual', value: 'manual', hint: '(full control)' },
  ], 'basic') as Promise<InitMode>;
}

async function chooseSecurityMode(): Promise<'none' | 'recoverable' | 'hard-lock'> {
  if (!isInteractiveCli()) {
    return 'recoverable';
  }
  return promptMenu('How would you like to secure your variables?', [
    { label: 'No encryption', value: 'none', hint: '(fastest local setup)' },
    { label: 'Encrypted with recovery key', value: 'recoverable', hint: '(recommended)' },
    { label: 'Encrypted hard-lock', value: 'hard-lock', hint: '(max security)' },
  ], 'recoverable') as Promise<'none' | 'recoverable' | 'hard-lock'>;
}

async function chooseServerMode(): Promise<'auto' | 'rest' | 'openai' | 'gemini' | 'all'> {
  if (!isInteractiveCli()) {
    return 'auto';
  }
  return promptMenu('Background service mode', [
    { label: 'Auto', value: 'auto', hint: '(recommended)' },
    { label: 'REST', value: 'rest' },
    { label: 'OpenAI', value: 'openai' },
    { label: 'Gemini', value: 'gemini' },
    { label: 'All', value: 'all' },
  ], 'auto') as Promise<'auto' | 'rest' | 'openai' | 'gemini' | 'all'>;
}

async function buildServiceSetup(projectPath: string, initMode: InitMode): Promise<{ enabled: boolean; startNow: boolean; config: ServiceConfig | null }> {
  if (!isInteractiveCli()) {
    return { enabled: false, startNow: false, config: null };
  }

  const wantsStartup = await promptConfirm(
    initMode === 'basic'
      ? 'Start EnvCP automatically in the background?'
      : 'Install background startup for EnvCP?',
    true,
  );
  if (!wantsStartup) {
    return { enabled: false, startNow: false, config: null };
  }

  const serviceConfig = await loadServiceConfig();
  serviceConfig.working_directory = projectPath;
  serviceConfig.autostart = true;

  if (initMode === 'manual') {
    serviceConfig.server.mode = await chooseServerMode();
    const hostInput = (await promptInput(`Service host [${serviceConfig.server.host}]:`)).trim();
    if (hostInput) {
      serviceConfig.server.host = hostInput;
    }

    const portInput = (await promptInput(`Service port [${serviceConfig.server.port}]:`)).trim();
    if (portInput) {
      const parsedPort = Number.parseInt(portInput, 10);
      if (!Number.isNaN(parsedPort) && parsedPort > 0) {
        serviceConfig.server.port = parsedPort;
      }
    }

    const apiKey = (await promptInput('HTTP API key (leave blank for local-only use):')).trim();
    serviceConfig.server.api_key = apiKey || undefined;
    serviceConfig.restart_on_failure = await promptConfirm('Restart service if it crashes?', true);
  }

  const startNow = initMode === 'basic'
    ? true
    : await promptConfirm('Start the background service now?', true);

  return { enabled: true, startNow, config: serviceConfig };
}

async function installStartupServiceIfNeeded(
  projectPath: string,
  serviceSetup: { enabled: boolean; startNow: boolean; config: ServiceConfig | null },
): Promise<void> {
  if (!serviceSetup.enabled || !serviceSetup.config) {
    return;
  }

  await saveServiceConfig(serviceSetup.config);
  const result = await installService({ workingDirectory: projectPath, now: serviceSetup.startNow });
  if (result.ok) {
    console.log(chalk.green('Background service configured.'));
    console.log(chalk.gray(`  ${result.message}`));
  } else {
    console.log(chalk.yellow('Background service setup could not be completed automatically.'));
    console.log(chalk.gray(`  ${result.message}`));
  }
}

async function summarizeServiceStatus(): Promise<string> {
  const serviceConfig = await loadServiceConfig();
  const status = await statusService();
  const active = status.ok ? 'running' : 'not running';
  return `${active}, autostart ${serviceConfig.autostart ? 'on' : 'off'}`;
}

async function maybeImportDotEnv(projectPath: string, config: EnvCPConfig, password: string, shouldImport: boolean): Promise<void> {
  if (!shouldImport) {
    return;
  }

  const envPath = path.join(projectPath, '.env');
  if (!await pathExists(envPath)) {
    return;
  }

  const envContent = await fs.readFile(envPath, 'utf8');
  const vars = parseEnvFile(envContent);
  const count = Object.keys(vars).length;
  if (count === 0) {
    return;
  }

  const storage = new StorageManager(
    path.join(projectPath, config.storage.path),
    config.storage.encrypted,
  );
  if (password) {
    storage.setPassword(password);
  }

  const now = new Date().toISOString();
  const existing = await storage.load();
  for (const [name, value] of Object.entries(vars)) {
    existing[name] = {
      name,
      value,
      encrypted: config.storage.encrypted,
      created: now,
      updated: now,
      sync_to_env: true,
      protected: false,
    };
  }
  await storage.save(existing);

  if (password && config.session?.enabled !== false) {
    const sessionManager = new SessionManager(
      resolveSessionPath(projectPath, config),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5,
    );
    await sessionManager.init();
    await sessionManager.create(password);
  }

  console.log(chalk.green(`  Imported ${count} variables from .env`));
  console.log(chalk.gray(`  Variables: ${Object.keys(vars).join(', ')}`));
}

async function runInitFlow(options: {
  project?: string;
  encrypt?: boolean;
  skipEnv?: boolean;
  skipMcp?: boolean;
  authMethod?: string;
  hsmType?: HsmType;
  keyId?: string;
  pkcs11Lib?: string;
} = {}): Promise<void> {
  const projectPath = process.cwd();
  const projectName = options.project || path.basename(projectPath);
  const configPath = path.join(projectPath, 'envcp.yaml');

  if (await pathExists(configPath)) {
    console.log(chalk.yellow('EnvCP is already set up here.'));
    console.log(chalk.gray(`  Config: ${configPath}`));
    console.log(chalk.gray('Run `envcp setup` to change project settings.'));
    return;
  }

  console.log(chalk.blue('Initializing EnvCP...'));
  console.log('');

  const config = await initConfig(projectPath, projectName);
  const initMode = await chooseInitMode();
  const hasDotEnv = await pathExists(path.join(projectPath, '.env'));

  const securityChoice = await resolveSecurityChoice(options, initMode);

  const securitySettings = buildSecuritySettings(securityChoice);
  config.encryption = securitySettings.encryption;
  config.storage.encrypted = securitySettings.storageEncrypted;
  config.security = securitySettings.security;

  await configureInitModeSettings(config, initMode, securityChoice);

  const password = await promptEncryptionPassword(securityChoice);
  if (securityChoice !== 'none' && !password) {
    return;
  }

  await saveConfig(config, projectPath);

  let shouldImportEnv: boolean;
  if (options.skipEnv || !hasDotEnv) {
    shouldImportEnv = false;
  } else if (isInteractiveCli()) {
    shouldImportEnv = await promptConfirm('Import variables from .env?', true);
  } else {
    shouldImportEnv = false;
  }
  await maybeImportDotEnv(projectPath, config, password, shouldImportEnv);

  const serviceSetup = await buildServiceSetup(projectPath, initMode);
  await installStartupServiceIfNeeded(projectPath, serviceSetup);

  await maybeWriteRecoveryKey(securityChoice, password, projectPath, config);

  if (!options.skipMcp) {
    const result = await registerMcpConfig(projectPath);
    logMcpRegistration(result);
  }

  await maybeConfigureHsmAuth(config, password, projectPath, options);

  const modeLabel = securityChoice === 'none' ? 'no encryption' : securityChoice;
  console.log(chalk.green('EnvCP initialized!'));
  console.log(chalk.gray(`  Project: ${config.project}`));
  console.log(chalk.gray(`  Mode: ${initMode}`));
  console.log(chalk.gray(`  Security: ${modeLabel}`));
  console.log(chalk.gray(`  Session: ${config.session.enabled ? 'on' : 'off'}`));
  console.log('');
  console.log(chalk.green('Done! Your AI tools can now use EnvCP.'));
}

async function runAddSecretFlow(): Promise<void> {
  const name = await promptInput('Secret name:');
  if (!name.trim()) {
    console.log(chalk.yellow('No secret name entered.'));
    return;
  }

  await withSession(async (storage, _password, config) => {
    const value = await promptPassword('Enter value:');
    const tagsInput = await promptInput('Tags (comma-separated):');
    const description = await promptInput('Description:');
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    const now = new Date().toISOString();
    const variable: Variable = {
      name: name.trim(),
      value,
      encrypted: config.storage.encrypted,
      tags: tags.length > 0 ? tags : undefined,
      description: description || undefined,
      created: now,
      updated: now,
      sync_to_env: true,
      protected: false,
    };

    await storage.set(variable.name, variable);
    console.log(chalk.green(`Variable '${variable.name}' added successfully`));
  });
}

async function handleConfigMenuChoice(
  choice: string,
  config: EnvCPConfig,
  serviceConfig: ServiceConfig,
  projectPath: string,
): Promise<boolean> {
  if (choice === 'general.session') {
    config.session.enabled = !config.session.enabled;
    await saveConfig(config, projectPath);
    return true;
  }
  if (choice === 'general.sync') {
    config.sync.enabled = !config.sync.enabled;
    await saveConfig(config, projectPath);
    return true;
  }
  if (choice === 'general.startup') {
    serviceConfig.autostart = !serviceConfig.autostart;
    serviceConfig.working_directory = projectPath;
    await saveServiceConfig(serviceConfig);
    const result = serviceConfig.autostart
      ? await installService({ workingDirectory: projectPath })
      : await uninstallService();
    console.log(result.ok ? chalk.green(result.message) : chalk.yellow(result.message));
    return true;
  }
  if (choice === 'general.mask') {
    config.access.mask_values = !config.access.mask_values;
    await saveConfig(config, projectPath);
    return true;
  }
  if (choice === 'advanced.audit') {
    config.audit.enabled = !config.audit.enabled;
    await saveConfig(config, projectPath);
    return true;
  }
  if (choice === 'advanced.confirm') {
    config.access.require_confirmation = !config.access.require_confirmation;
    await saveConfig(config, projectPath);
    return true;
  }
  if (choice === 'advanced.startup-status') {
    console.log(chalk.gray(await summarizeServiceStatus()));
    await promptInput('Press Enter to continue');
    return true;
  }
  if (choice === 'advanced.path') {
    console.log(chalk.gray(path.join(projectPath, 'envcp.yaml')));
    await promptInput('Press Enter to continue');
    return true;
  }
  if (choice === 'advanced.reload') {
    const configGuard = new ConfigGuard(projectPath);
    const password = await promptPassword('Enter password to reload config:');
    const result = await configGuard.reload(password);
    console.log(result.success ? chalk.green('Config reloaded successfully') : chalk.red(result.error || 'Failed to reload config'));
    return true;
  }
  return false;
}

function buildConfigMenuTabs(config: EnvCPConfig, serviceConfig: ServiceConfig): MenuTab[] {
  return [
    {
      label: 'General',
      items: [
        { label: 'Toggle session', value: 'general.session', hint: config.session.enabled ? '(on)' : '(off)' },
        { label: 'Toggle sync to .env', value: 'general.sync', hint: config.sync.enabled ? '(on)' : '(off)' },
        { label: 'Toggle startup service', value: 'general.startup', hint: serviceConfig.autostart ? '(on)' : '(off)' },
        { label: 'Toggle masked values', value: 'general.mask', hint: config.access.mask_values ? '(on)' : '(off)' },
        { label: 'Back', value: 'general.back' },
      ],
    },
    {
      label: 'Advanced',
      items: [
        { label: 'Toggle audit logging', value: 'advanced.audit', hint: config.audit.enabled ? '(on)' : '(off)' },
        { label: 'Toggle AI confirmation', value: 'advanced.confirm', hint: config.access.require_confirmation ? '(on)' : '(off)' },
        { label: 'Show startup status', value: 'advanced.startup-status', hint: '(service)' },
        { label: 'Show config path', value: 'advanced.path', hint: '(envcp.yaml)' },
        { label: 'Reload config guard', value: 'advanced.reload', hint: '(password required)' },
        { label: 'Back', value: 'advanced.back' },
      ],
    },
  ];
}

async function printNonInteractiveConfigSummary(config: EnvCPConfig): Promise<void> {
  console.log(chalk.blue('EnvCP config'));
  console.log(chalk.gray(`  Session: ${config.session.enabled ? 'on' : 'off'}`));
  console.log(chalk.gray(`  Sync: ${config.sync.enabled ? 'on' : 'off'}`));
  console.log(chalk.gray(`  Audit: ${config.audit.enabled ? 'on' : 'off'}`));
  console.log(chalk.gray(`  Startup: ${await summarizeServiceStatus()}`));
}

async function runConfigMenu(): Promise<void> {
  const projectPath = process.cwd();
  const config = await loadConfig(projectPath);
  const serviceConfig = await loadServiceConfig();

  if (!isInteractiveCli()) {
    await printNonInteractiveConfigSummary(config);
    return;
  }

  while (true) {
    const choice = await promptTabbedMenu('EnvCP config', buildConfigMenuTabs(config, serviceConfig));

    if (choice.endsWith('.back')) {
      return;
    }

    if (await handleConfigMenuChoice(choice, config, serviceConfig, projectPath)) {
      continue;
    }
  }
}

type VariableRuleField =
  | 'allow_ai_read'
  | 'allow_ai_write'
  | 'allow_ai_delete'
  | 'allow_ai_export'
  | 'allow_ai_execute'
  | 'require_confirmation';

type DefaultRuleField = VariableRuleField | 'allow_ai_active_check';
type VariableRule = EnvCPConfig['access']['variable_rules'][string];
type AccessClientRule = EnvCPConfig['access']['client_rules'][string];

function parseVariableRuleField(operation: string): VariableRuleField | null {
  switch (operation) {
    case 'read':
      return 'allow_ai_read';
    case 'write':
      return 'allow_ai_write';
    case 'delete':
      return 'allow_ai_delete';
    case 'export':
      return 'allow_ai_export';
    case 'run':
    case 'execute':
      return 'allow_ai_execute';
    case 'confirm':
    case 'confirmation':
      return 'require_confirmation';
    default:
      return null;
  }
}

function parseDefaultRuleField(operation: string): DefaultRuleField | null {
  switch (operation) {
    case 'list':
    case 'show':
    case 'names':
    case 'active-check':
    case 'active_check':
      return 'allow_ai_active_check';
    default:
      return parseVariableRuleField(operation);
  }
}

function formatRuleSetting(value: boolean, enabledLabel = 'allow', disabledLabel = 'deny'): string {
  return value ? enabledLabel : disabledLabel;
}

function formatVariableRuleLines(rule: VariableRule): string[] {
  const lines: string[] = [];
  const fields: Array<[keyof VariableRule, string, string, string]> = [
    ['allow_ai_read', 'read', 'allow', 'deny'],
    ['allow_ai_write', 'write', 'allow', 'deny'],
    ['allow_ai_delete', 'delete', 'allow', 'deny'],
    ['allow_ai_export', 'export', 'allow', 'deny'],
    ['allow_ai_execute', 'run', 'allow', 'deny'],
    ['require_confirmation', 'confirmation', 'on', 'off'],
  ];

  for (const [field, label, enabledLabel, disabledLabel] of fields) {
    if (typeof rule[field] === 'boolean') {
      lines.push(`${label}: ${formatRuleSetting(rule[field], enabledLabel, disabledLabel)}`);
    }
  }

  if (rule.active_window) {
    lines.push(`active: ${rule.active_window.start}-${rule.active_window.end}`);
  }

  return lines.length > 0 ? lines : ['inherit all defaults'];
}

function formatClientRuleLines(rule: AccessClientRule): string[] {
  const lines: string[] = [];
  const fields: Array<[keyof AccessClientRule, string, string, string]> = [
    ['allow_ai_read', 'read', 'allow', 'deny'],
    ['allow_ai_write', 'write', 'allow', 'deny'],
    ['allow_ai_delete', 'delete', 'allow', 'deny'],
    ['allow_ai_export', 'export', 'allow', 'deny'],
    ['allow_ai_execute', 'run', 'allow', 'deny'],
    ['allow_ai_active_check', 'list names', 'allow', 'deny'],
    ['require_confirmation', 'confirmation', 'on', 'off'],
  ];

  for (const [field, label, enabledLabel, disabledLabel] of fields) {
    if (typeof rule[field] === 'boolean') {
      lines.push(`${label}: ${formatRuleSetting(rule[field], enabledLabel, disabledLabel)}`);
    }
  }

  return lines.length > 0 ? lines : ['inherit global defaults'];
}

function describeClientId(clientId: string): string {
  switch (clientId) {
    case 'openai':
      return 'OpenAI-compatible';
    case 'gemini':
      return 'Gemini-compatible';
    case 'mcp':
      return 'MCP client';
    case 'api':
      return 'REST API client';
    case 'cli':
      return 'EnvCP CLI';
    default:
      return 'Custom client';
  }
}

function formatClientLabel(clientId: string): string {
  return `${describeClientId(clientId)} (${clientId})`;
}

function getClientRule(config: EnvCPConfig, clientId: string): AccessClientRule {
  return {
    ...config.access.client_rules?.[clientId],
    variable_rules: {
      ...config.access.client_rules?.[clientId]?.variable_rules,
    },
  };
}

function saveClientRule(config: EnvCPConfig, clientId: string, rule: AccessClientRule): void {
  const nextRules = { ...config.access.client_rules };
  const hasDefaults = [
    rule.allow_ai_read,
    rule.allow_ai_write,
    rule.allow_ai_delete,
    rule.allow_ai_export,
    rule.allow_ai_execute,
    rule.allow_ai_active_check,
    rule.require_confirmation,
  ].some((value) => typeof value === 'boolean');
  const hasVariables = Object.keys(rule.variable_rules || {}).length > 0;

  if (hasDefaults || hasVariables) {
    nextRules[clientId] = {
      ...rule,
      variable_rules: rule.variable_rules || {},
    };
  } else {
    delete nextRules[clientId];
  }

  config.access.client_rules = nextRules;
}

function updateVariableRule(
  config: EnvCPConfig,
  variableName: string,
  field: VariableRuleField,
  value: boolean | undefined,
  clientId?: string,
): void {
  if (clientId) {
    const clientRule = getClientRule(config, clientId);
    const current = { ...clientRule.variable_rules?.[variableName] };

    if (value === undefined) {
      delete current[field];
    } else {
      current[field] = value;
    }

    const nextVariableRules = { ...clientRule.variable_rules };
    if (Object.keys(current).length === 0) {
      delete nextVariableRules[variableName];
    } else {
      nextVariableRules[variableName] = current;
    }

    clientRule.variable_rules = nextVariableRules;
    saveClientRule(config, clientId, clientRule);
    return;
  }

  const current = { ...config.access.variable_rules?.[variableName] };

  if (value === undefined) {
    delete current[field];
  } else {
    current[field] = value;
  }

  const nextRules = { ...config.access.variable_rules };
  if (Object.keys(current).length === 0) {
    delete nextRules[variableName];
  } else {
    nextRules[variableName] = current;
  }

  config.access.variable_rules = nextRules;
}

function setVariableRuleWindow(
  config: EnvCPConfig,
  variableName: string,
  start: string | undefined,
  end: string | undefined,
  clientId?: string,
): void {
  if (clientId) {
    const clientRule = getClientRule(config, clientId);
    const current = { ...clientRule.variable_rules?.[variableName] };
    if (start && end) {
      current.active_window = { start, end };
    } else {
      delete current.active_window;
    }

    const nextVariableRules = { ...clientRule.variable_rules };
    if (Object.keys(current).length === 0) {
      delete nextVariableRules[variableName];
    } else {
      nextVariableRules[variableName] = current;
    }
    clientRule.variable_rules = nextVariableRules;
    saveClientRule(config, clientId, clientRule);
    return;
  }

  const current = { ...config.access.variable_rules?.[variableName] };
  if (!start || !end) {
    delete current.active_window;
  } else {
    current.active_window = { start, end };
  }

  const nextRules = { ...config.access.variable_rules };
  if (Object.keys(current).length === 0) {
    delete nextRules[variableName];
  } else {
    nextRules[variableName] = current;
  }
  config.access.variable_rules = nextRules;
}

async function promptClientRuleTarget(): Promise<string | undefined> {
  const target = await promptMenu('Apply rule to', [
    { label: 'Everyone', value: 'global' },
    { label: 'One client / who', value: 'client' },
  ], 'global');

  if (target !== 'client') {
    return undefined;
  }

  const clientId = (await promptInput('Client id (examples: mcp, openai, gemini, api, cursor):')).trim();
  return clientId || undefined;
}

async function editVariableRule(config: EnvCPConfig, clientId?: string): Promise<void> {
  const variableName = (await promptInput('Variable name:')).trim();
  if (!variableName) {
    return;
  }

  const field = await promptMenu(`Rule for ${variableName}`, [
    { label: 'AI read', value: 'allow_ai_read' },
    { label: 'AI write', value: 'allow_ai_write' },
    { label: 'AI delete', value: 'allow_ai_delete' },
    { label: 'AI export', value: 'allow_ai_export' },
    { label: 'AI run', value: 'allow_ai_execute' },
    { label: 'Require confirmation', value: 'require_confirmation' },
  ]) as VariableRuleField;

  const value = await promptMenu(`Set ${field} for ${variableName}`, [
    { label: 'Allow', value: 'allow' },
    { label: 'Deny', value: 'deny' },
    { label: 'Inherit default', value: 'inherit' },
  ], 'inherit');

  updateVariableRule(
    config,
    variableName,
    field,
    value === 'inherit' ? undefined : value === 'allow',
    clientId,
  );
}

async function removeVariableRule(config: EnvCPConfig, clientId?: string): Promise<void> {
  const variableName = (await promptInput('Variable rule to remove:')).trim();
  if (!variableName) {
    return;
  }
  if (clientId) {
    const clientRule = getClientRule(config, clientId);
    const nextVariableRules = { ...clientRule.variable_rules };
    delete nextVariableRules[variableName];
    clientRule.variable_rules = nextVariableRules;
    saveClientRule(config, clientId, clientRule);
    return;
  }
  const nextRules = { ...config.access.variable_rules };
  delete nextRules[variableName];
  config.access.variable_rules = nextRules;
}

async function editVariableRuleWindow(config: EnvCPConfig, clientId?: string): Promise<void> {
  const variableName = (await promptInput('Variable name:')).trim();
  if (!variableName) {
    return;
  }

  const start = (await promptInput('Allowed from (HH:MM):')).trim();
  const end = (await promptInput('Allowed until (HH:MM):')).trim();
  setVariableRuleWindow(config, variableName, start, end, clientId);
}

function applyDefaultRule(config: EnvCPConfig, field: DefaultRuleField, value: boolean | undefined, clientId?: string): void {
  if (clientId) {
    const clientRule = getClientRule(config, clientId);
    if (value === undefined) {
      delete clientRule[field];
    } else {
      clientRule[field] = value;
    }
    saveClientRule(config, clientId, clientRule);
    return;
  }

  switch (field) {
    case 'allow_ai_read':
      config.access.allow_ai_read = value === true;
      break;
    case 'allow_ai_write':
      config.access.allow_ai_write = value === true;
      break;
    case 'allow_ai_delete':
      config.access.allow_ai_delete = value === true;
      break;
    case 'allow_ai_export':
      config.access.allow_ai_export = value === true;
      break;
    case 'allow_ai_execute':
      config.access.allow_ai_execute = value === true;
      break;
    case 'allow_ai_active_check':
      config.access.allow_ai_active_check = value === true;
      break;
    case 'require_confirmation':
      config.access.require_confirmation = value === true;
      break;
  }
}

type RuleScope = 'project' | 'home' | 'merged';

function parseRuleScope(value: string | undefined, fallback: RuleScope): RuleScope {
  if (!value) {
    return fallback;
  }
  if (value === 'project' || value === 'home' || value === 'merged') {
    return value;
  }
  throw new Error(`Unknown scope '${value}'. Use project, home, or merged.`);
}

async function chooseEditableRuleScope(): Promise<Exclude<RuleScope, 'merged'>> {
  return promptMenu('Rule scope', [
    { label: 'This project', value: 'project' },
    { label: 'Home / whole computer', value: 'home' },
  ], 'project') as Promise<Exclude<RuleScope, 'merged'>>;
}

function describeMergedDefaultOrigin<T>(mergedValue: T, projectValue: T, homeValue: T): string {
  const sameAsProject = JSON.stringify(mergedValue) === JSON.stringify(projectValue);
  const sameAsHome = JSON.stringify(mergedValue) === JSON.stringify(homeValue);
  if (sameAsProject && sameAsHome) {
    return 'default';
  }
  if (sameAsProject && !sameAsHome) {
    return 'project';
  }
  if (!sameAsProject && sameAsHome) {
    return 'home';
  }
  return 'merged';
}

function describeMergedVariableRuleOrigin(
  name: string,
  mergedRule: unknown,
  projectRules: Record<string, unknown>,
  homeRules: Record<string, unknown>,
): string {
  const projectRule = projectRules[name];
  const homeRule = homeRules[name];
  if (projectRule && homeRule) {
    return JSON.stringify(mergedRule) === JSON.stringify(projectRule)
      ? 'project overrides home'
      : 'home + project';
  }
  if (projectRule) {
    return 'project';
  }
  if (homeRule) {
    return 'home';
  }
  return 'merged';
}

function describeMergedClientRuleOrigin(
  clientId: string,
  mergedRule: unknown,
  projectRules: Record<string, unknown>,
  homeRules: Record<string, unknown>,
): string {
  const projectRule = projectRules[clientId];
  const homeRule = homeRules[clientId];
  if (projectRule && homeRule) {
    return JSON.stringify(mergedRule) === JSON.stringify(projectRule)
      ? 'project overrides home'
      : 'home + project';
  }
  if (projectRule) {
    return 'project';
  }
  if (homeRule) {
    return 'home';
  }
  return 'merged';
}

async function applyDefaultClientRule(config: EnvCPConfig): Promise<void> {
  const clientId = await promptClientRuleTarget();
  if (!clientId) return;
  const field = await promptMenu(`Default rule for ${clientId}`, [
    { label: 'AI read', value: 'allow_ai_read' },
    { label: 'AI write', value: 'allow_ai_write' },
    { label: 'AI delete', value: 'allow_ai_delete' },
    { label: 'AI export', value: 'allow_ai_export' },
    { label: 'AI run', value: 'allow_ai_execute' },
    { label: 'AI list names', value: 'allow_ai_active_check' },
    { label: 'Require confirmation', value: 'require_confirmation' },
  ]) as DefaultRuleField;
  const value = await promptMenu(`Set ${field} for ${clientId}`, [
    { label: 'Allow / on', value: 'allow' },
    { label: 'Deny / off', value: 'deny' },
    { label: 'Inherit global default', value: 'inherit' },
  ], 'inherit');
  applyDefaultRule(config, field, value === 'inherit' ? undefined : value === 'allow', clientId);
}

async function applyVariableClearWindow(config: EnvCPConfig): Promise<void> {
  const variable = (await promptInput('Variable name:')).trim();
  if (variable) {
    setVariableRuleWindow(config, variable, undefined, undefined);
  }
}

async function applyWhoEdit(config: EnvCPConfig): Promise<void> {
  const clientId = await promptClientRuleTarget();
  if (clientId) {
    await editVariableRule(config, clientId);
  }
}

async function applyWhoWindow(config: EnvCPConfig): Promise<void> {
  const clientId = await promptClientRuleTarget();
  if (clientId) {
    await editVariableRuleWindow(config, clientId);
  }
}

async function applyWhoClearWindow(config: EnvCPConfig): Promise<void> {
  const clientId = await promptClientRuleTarget();
  if (!clientId) return;
  const variable = (await promptInput('Variable name:')).trim();
  if (variable) {
    setVariableRuleWindow(config, variable, undefined, undefined, clientId);
  }
}

async function applyWhoRemove(config: EnvCPConfig): Promise<void> {
  const clientId = await promptClientRuleTarget();
  if (clientId) {
    await removeVariableRule(config, clientId);
  }
}

async function dispatchRuleChoice(choice: string, config: EnvCPConfig): Promise<void> {
  switch (choice) {
    case 'default.read': config.access.allow_ai_read = !config.access.allow_ai_read; break;
    case 'default.write': config.access.allow_ai_write = !config.access.allow_ai_write; break;
    case 'default.delete': config.access.allow_ai_delete = !config.access.allow_ai_delete; break;
    case 'default.run': config.access.allow_ai_execute = !config.access.allow_ai_execute; break;
    case 'default.list': config.access.allow_ai_active_check = !config.access.allow_ai_active_check; break;
    case 'default.client': await applyDefaultClientRule(config); break;
    case 'variable.edit': await editVariableRule(config); break;
    case 'variable.window': await editVariableRuleWindow(config); break;
    case 'variable.clear-window': await applyVariableClearWindow(config); break;
    case 'variable.remove': await removeVariableRule(config); break;
    case 'who.edit': await applyWhoEdit(config); break;
    case 'who.window': await applyWhoWindow(config); break;
    case 'who.clear-window': await applyWhoClearWindow(config); break;
    case 'who.remove': await applyWhoRemove(config); break;
  }
}

function buildRuleMenuTabs(config: EnvCPConfig): MenuTab[] {
  return [
    {
      label: 'Defaults',
      items: [
        { label: 'Toggle AI read', value: 'default.read', hint: config.access.allow_ai_read ? '(allow)' : '(deny)' },
        { label: 'Toggle AI write', value: 'default.write', hint: config.access.allow_ai_write ? '(allow)' : '(deny)' },
        { label: 'Toggle AI delete', value: 'default.delete', hint: config.access.allow_ai_delete ? '(allow)' : '(deny)' },
        { label: 'Toggle AI run', value: 'default.run', hint: config.access.allow_ai_execute ? '(allow)' : '(deny)' },
        { label: 'Toggle AI list names', value: 'default.list', hint: config.access.allow_ai_active_check ? '(allow)' : '(deny)' },
        { label: 'Edit one who default rule', value: 'default.client', hint: `(${Object.keys(config.access.client_rules || {}).length} saved)` },
        { label: 'Back', value: 'default.back' },
      ],
    },
    {
      label: 'Variable',
      items: [
        { label: 'Edit one variable rule', value: 'variable.edit', hint: `(${Object.keys(config.access.variable_rules || {}).length} saved)` },
        { label: 'Set active time window', value: 'variable.window', hint: '(HH:MM -> HH:MM)' },
        { label: 'Clear active time window', value: 'variable.clear-window', hint: '(one variable)' },
        { label: 'Remove one variable rule', value: 'variable.remove', hint: '(exact variable name)' },
        { label: 'Show variable rule names', value: 'variable.list', hint: '(saved rules)' },
        { label: 'Back', value: 'variable.back' },
      ],
    },
    {
      label: 'Who',
      items: [
        { label: 'Edit one who variable rule', value: 'who.edit', hint: `(${Object.keys(config.access.client_rules || {}).length} clients)` },
        { label: 'Set who time window', value: 'who.window', hint: '(client + variable)' },
        { label: 'Clear who time window', value: 'who.clear-window', hint: '(client + variable)' },
        { label: 'Remove one who variable rule', value: 'who.remove', hint: '(client + variable)' },
        { label: 'Show who names', value: 'who.list', hint: '(saved clients)' },
        { label: 'Back', value: 'who.back' },
      ],
    },
  ];
}

async function showRuleNames(projectPath: string, kind: 'variable' | 'who'): Promise<void> {
  const config = await loadScopedConfig(projectPath, 'merged');
  const map = kind === 'variable' ? (config.access.variable_rules || {}) : (config.access.client_rules || {});
  const names = Object.keys(map);
  const emptyMsg = kind === 'variable' ? 'No variable-specific rules yet.' : 'No who-specific rules yet.';
  console.log(names.length > 0 ? chalk.gray(names.join(', ')) : chalk.gray(emptyMsg));
  await promptInput('Press Enter to continue');
}

function printNonInteractiveRulesSummary(config: EnvCPConfig): void {
  console.log(chalk.blue('EnvCP rules'));
  console.log(chalk.gray(`  AI read: ${config.access.allow_ai_read ? 'allow' : 'deny'}`));
  console.log(chalk.gray(`  AI write: ${config.access.allow_ai_write ? 'allow' : 'deny'}`));
  console.log(chalk.gray(`  AI delete: ${config.access.allow_ai_delete ? 'allow' : 'deny'}`));
  console.log(chalk.gray(`  AI run: ${config.access.allow_ai_execute ? 'allow' : 'deny'}`));
  console.log(chalk.gray(`  Variable rules: ${Object.keys(config.access.variable_rules || {}).length}`));
  console.log(chalk.gray(`  Who rules: ${Object.keys(config.access.client_rules || {}).length}`));
}

async function runRuleMenu(): Promise<void> {
  const projectPath = process.cwd();
  let config = await loadScopedConfig(projectPath, 'merged');

  if (!isInteractiveCli()) {
    printNonInteractiveRulesSummary(config);
    return;
  }

  while (true) {
    const choice = await promptTabbedMenu('EnvCP rules', buildRuleMenuTabs(config));

    if (choice.endsWith('.back')) {
      return;
    }

    if (choice === 'variable.list') {
      await showRuleNames(projectPath, 'variable');
      continue;
    }

    if (choice === 'who.list') {
      await showRuleNames(projectPath, 'who');
      continue;
    }

    const scope = await chooseEditableRuleScope();
    config = await loadScopedConfig(projectPath, scope);
    await dispatchRuleChoice(choice, config);
    await saveScopedConfig(config, projectPath, scope);
  }
}

type UnlockOptions = {
  recoveryKey?: string;
  saveToKeychain?: boolean;
  setupHsm?: boolean;
  hsmType?: string;
  keyId?: string;
  pkcs11Lib?: string;
  global?: boolean;
};

interface BfpSettings {
  lockoutThreshold: number;
  lockoutBaseSeconds: number;
  progressiveDelay: boolean;
  maxDelay: number;
  permanentThreshold: number;
}

function resolveBfpSettings(config: EnvCPConfig): BfpSettings {
  const bfpConfig = config.security?.brute_force_protection;
  return {
    lockoutThreshold: bfpConfig?.max_attempts ?? config.session?.lockout_threshold ?? 5,
    lockoutBaseSeconds: bfpConfig?.lockout_duration ?? config.session?.lockout_base_seconds ?? 60,
    progressiveDelay: bfpConfig?.progressive_delay ?? true,
    maxDelay: bfpConfig?.max_delay ?? 60,
    permanentThreshold: bfpConfig?.permanent_lockout_threshold ?? 0,
  };
}

async function clearLockoutWithRecoveryKey(
  projectPath: string,
  config: EnvCPConfig,
  lockoutManager: LockoutManager,
  logManager: LogManager,
  recoveryKey: string,
  logMessage: string,
): Promise<boolean> {
  const recoveryPath = path.join(projectPath, config.security?.recovery_file || '.envcp/.recovery');
  if (!await pathExists(recoveryPath)) {
    console.log(chalk.red('No recovery file found.'));
    return false;
  }

  const recoveryData = await fs.readFile(recoveryPath, 'utf8');
  try {
    await recoverPassword(recoveryData, recoveryKey);
    await lockoutManager.clearPermanentLockout();
    console.log(chalk.green('Permanent lockout cleared.'));

    await logManager.log({
      timestamp: new Date().toISOString(),
      operation: 'unlock',
      variable: '',
      source: 'cli',
      success: true,
      message: logMessage,
      session_id: '',
      client_id: 'cli',
      client_type: 'terminal',
      ip: '127.0.0.1',
    });
    return true;
  } catch {
    console.log(chalk.red('Invalid recovery key.'));
    return false;
  }
}

async function handlePermanentLockoutPrompt(
  projectPath: string,
  config: EnvCPConfig,
  lockoutManager: LockoutManager,
  logManager: LogManager,
): Promise<boolean> {
  console.log(chalk.red.bold('PERMANENT LOCKOUT: Too many failed attempts.'));
  console.log(chalk.red('Recovery key or administrator intervention required.'));

  const useRecovery = await promptConfirm('Use recovery key to clear lockout?', true);
  if (!useRecovery) return false;

  const recoveryKey = await promptPassword('Enter recovery key:');
  const ok = await clearLockoutWithRecoveryKey(
    projectPath,
    config,
    lockoutManager,
    logManager,
    recoveryKey,
    'Permanent lockout cleared with recovery key',
  );
  if (ok) {
    console.log(chalk.yellow('Note: You still need to enter the correct password.'));
  }
  return ok;
}

async function ensureInitialLockoutCleared(
  projectPath: string,
  config: EnvCPConfig,
  lockoutManager: LockoutManager,
  logManager: LogManager,
  storeExists: boolean,
): Promise<boolean> {
  if (!storeExists) return true;
  const lockoutStatus = await lockoutManager.check();
  if (!lockoutStatus.locked) return true;

  if (lockoutStatus.permanent_locked) {
    return handlePermanentLockoutPrompt(projectPath, config, lockoutManager, logManager);
  }

  console.log(chalk.red(`Too many failed attempts. Try again in ${lockoutStatus.remaining_seconds} second(s).`));
  return false;
}

async function maybeCreateRecoveryData(projectPath: string, config: EnvCPConfig, password: string): Promise<void> {
  if (config.security?.mode !== 'recoverable') return;
  const recoveryPath = path.join(projectPath, config.security.recovery_file || '.envcp/.recovery');
  if (await pathExists(recoveryPath)) return;

  const recoveryKey = generateRecoveryKey();
  const recoveryData = await createRecoveryData(password, recoveryKey);
  await ensureDir(path.dirname(recoveryPath));
  await fs.writeFile(recoveryPath, recoveryData, 'utf8');

  console.log('');
  console.log(chalk.yellow.bold('RECOVERY KEY (save this somewhere safe!):'));
  console.log(chalk.yellow.bold(`  ${recoveryKey}`));
  console.log(chalk.gray('This key is shown ONCE. If you lose it, you cannot recover your password.'));
  console.log('');
}

async function recordUnlockFailure(
  lockoutManager: LockoutManager,
  logManager: LogManager,
  bfp: BfpSettings,
): Promise<void> {
  const status = await lockoutManager.recordFailure(
    bfp.lockoutThreshold,
    bfp.lockoutBaseSeconds,
    bfp.progressiveDelay,
    bfp.maxDelay,
    bfp.permanentThreshold,
  );

  await logManager.log({
    timestamp: new Date().toISOString(),
    operation: 'auth_failure',
    variable: '',
    source: 'cli',
    success: false,
    message: `Failed unlock attempt (attempt ${status.attempts})`,
    session_id: '',
    client_id: 'cli',
    client_type: 'terminal',
    ip: '127.0.0.1',
  });

  if (status.permanent_locked) {
    console.log(chalk.red.bold('PERMANENT LOCKOUT TRIGGERED: Too many failed attempts.'));
    console.log(chalk.red('Recovery key or administrator intervention required.'));
    await logManager.log({
      timestamp: new Date().toISOString(),
      operation: 'permanent_lockout',
      variable: '',
      source: 'cli',
      success: false,
      message: `Permanent lockout triggered after ${status.permanent_lockout_count} lockouts`,
      session_id: '',
      client_id: 'cli',
      client_type: 'terminal',
      ip: '127.0.0.1',
    });
    return;
  }

  if (status.locked) {
    console.log(chalk.red(`Invalid password. Too many failed attempts — locked out for ${status.remaining_seconds} second(s).`));
    await logManager.log({
      timestamp: new Date().toISOString(),
      operation: 'lockout_triggered',
      variable: '',
      source: 'cli',
      success: false,
      message: `Lockout triggered for ${status.remaining_seconds}s (lockout #${status.lockout_count})`,
      session_id: '',
      client_id: 'cli',
      client_type: 'terminal',
      ip: '127.0.0.1',
    });
    return;
  }

  const remaining = bfp.lockoutThreshold - status.attempts;
  let message = `Invalid password. ${remaining} attempt(s) remaining before lockout.`;
  if (status.delay_seconds && status.delay_seconds > 0) {
    message += ` (Delayed ${status.delay_seconds}s)`;
  }
  console.log(chalk.red(message));
}

async function createUnlockSession(
  config: EnvCPConfig,
  sessionManager: SessionManager,
  logManager: LogManager,
  password: string,
): Promise<void> {
  if (config.session?.enabled === false) {
    await sessionManager.destroy();
    console.log(chalk.green('Password verified.'));
    console.log(chalk.gray('Session mode is off, so EnvCP will ask again next time.'));
    return;
  }

  const session = await sessionManager.create(password);
  await logManager.log({
    timestamp: new Date().toISOString(),
    operation: 'unlock',
    variable: '',
    source: 'cli',
    success: true,
    message: 'Session unlocked successfully',
    session_id: session.id,
    client_id: 'cli',
    client_type: 'terminal',
    ip: '127.0.0.1',
  });

  console.log(chalk.green('Session unlocked!'));
  console.log(chalk.gray(`  Session ID: ${session.id}`));
  console.log(chalk.gray(`  Expires in: ${config.session?.timeout_minutes || 30} minutes`));
  const maxExt = config.session?.max_extensions || 5;
  console.log(chalk.gray(`  Extensions remaining: ${maxExt - session.extensions}/${maxExt}`));
}

async function savePasswordToKeychainIfRequested(
  config: EnvCPConfig,
  projectPath: string,
  password: string,
): Promise<void> {
  const keychain = new KeychainManager(config.keychain?.service || 'envcp');
  if (!await keychain.isAvailable()) {
    console.log(chalk.red(`OS keychain not available (${keychain.backendName})`));
    return;
  }
  const result = await keychain.storePassword(password, projectPath);
  if (result.success) {
    config.keychain = { ...config.keychain, enabled: true };
    await saveConfig(config, projectPath);
    console.log(chalk.green(`Password saved to ${keychain.backendName}`));
    console.log(chalk.gray('  Future sessions will auto-unlock from keychain'));
  } else {
    console.log(chalk.red(`Failed to save to keychain: ${result.error}`));
  }
}

async function setupHsmIfRequested(
  config: EnvCPConfig,
  projectPath: string,
  password: string,
  options: UnlockOptions,
): Promise<void> {
  const hsmType = (options.hsmType as HsmType) || 'yubikey';

  config.hsm = {
    ...config.hsm,
    enabled: true,
    type: hsmType,
    key_id: options.keyId ?? config.hsm?.key_id,
    pkcs11_lib: options.pkcs11Lib ?? config.hsm?.pkcs11_lib,
    require_touch: config.hsm?.require_touch ?? true,
    protected_key_path: config.hsm?.protected_key_path ?? '.envcp/.hsm-key',
  };
  config.auth = { ...config.auth, method: 'hsm', fallback: config.auth?.fallback ?? 'password' };

  const hsm = HsmManager.fromConfig(config, projectPath);
  if (!await hsm.isAvailable()) {
    console.log(chalk.red(`HSM device (${hsm.backendName}) not available. Aborting HSM setup.`));
    return;
  }

  try {
    await hsm.protectVaultPassword(password);
    await saveConfig(config, projectPath);
    console.log(chalk.green(`Vault password protected by ${hsm.backendName}`));
    console.log(chalk.gray(`  Key file: ${config.hsm.protected_key_path}`));
    console.log(chalk.gray('  Future sessions will authenticate via hardware'));
  } catch (err: unknown) {
    console.log(chalk.red(`HSM setup failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

function validateUnlockPassword(password: string, config: EnvCPConfig): boolean {
  const { valid: passwordValid, warning: passwordWarning } = validatePassword(password, config.password || {});
  if (!passwordValid) {
    console.log(chalk.red('Invalid password'));
    return false;
  }
  if (passwordWarning) {
    console.log(chalk.yellow('⚠ Weak password detected'));
  }
  return true;
}

async function confirmNewVaultPassword(
  projectPath: string,
  config: EnvCPConfig,
  password: string,
): Promise<boolean> {
  const confirmPasswordValue = await promptPassword('Confirm password:');
  if (!secureCompare(Buffer.from(confirmPasswordValue, 'utf8'), Buffer.from(password, 'utf8'))) {
    console.log(chalk.red('Passwords do not match'));
    return false;
  }
  await maybeCreateRecoveryData(projectPath, config, password);
  return true;
}

async function attemptStorageLoad(
  storage: StorageManager,
  storeExists: boolean,
  lockoutManager: LockoutManager,
  logManager: LogManager,
  bfp: BfpSettings,
): Promise<boolean> {
  try {
    await storage.load();
    return true;
  } catch {
    if (storeExists) {
      await recordUnlockFailure(lockoutManager, logManager, bfp);
    } else {
      console.log(chalk.red('Invalid password'));
    }
    return false;
  }
}

async function runUnlockFlow(options: UnlockOptions = {}): Promise<void> {
  const { projectPath, config } = await resolveCliContext(options.global ? 'global' : undefined);

  const password = await promptPassword('Enter password:');
  if (!validateUnlockPassword(password, config)) {
    return;
  }

  const sessionDir = path.dirname(resolveSessionPath(projectPath, config));
  const lockoutManager = new LockoutManager(path.join(sessionDir, '.lockout'));

  const logManager = new LogManager(resolveLogPath(config.audit, projectPath), config.audit);
  await logManager.init();

  if (options.recoveryKey) {
    const ok = await clearLockoutWithRecoveryKey(
      projectPath,
      config,
      lockoutManager,
      logManager,
      options.recoveryKey,
      'Permanent lockout cleared with recovery key (via --recovery-key flag)',
    );
    if (!ok) return;
    console.log(chalk.yellow('Note: You still need to enter the correct password.'));
  }

  const bfp = resolveBfpSettings(config);

  const sessionManager = new SessionManager(
    resolveSessionPath(projectPath, config),
    config.session?.timeout_minutes || 30,
    config.session?.max_extensions || 5,
  );
  await sessionManager.init();

  const vaultPathForUnlock = await resolveVaultPath(projectPath, config);
  const storage = new StorageManager(vaultPathForUnlock, config.storage.encrypted);
  storage.setPassword(password);

  const storeExists = await storage.exists();

  if (!await ensureInitialLockoutCleared(projectPath, config, lockoutManager, logManager, storeExists)) {
    return;
  }

  if (!storeExists && !await confirmNewVaultPassword(projectPath, config, password)) {
    return;
  }

  if (!await attemptStorageLoad(storage, storeExists, lockoutManager, logManager, bfp)) {
    return;
  }

  await lockoutManager.reset();
  await createUnlockSession(config, sessionManager, logManager, password);

  if (options.saveToKeychain) {
    await savePasswordToKeychainIfRequested(config, projectPath, password);
  }

  if (options.setupHsm) {
    await setupHsmIfRequested(config, projectPath, password, options);
  }
}

async function runLockFlow(global = false): Promise<void> {
  const { projectPath, config } = await resolveCliContext(global ? 'global' : undefined);

  if (config.session?.enabled === false) {
    console.log(chalk.gray('Session mode is already off.'));
    return;
  }

  const sessionManager = new SessionManager(
    resolveSessionPath(projectPath, config),
    config.session?.timeout_minutes || 30,
    config.session?.max_extensions || 5,
  );
  await sessionManager.init();
  await sessionManager.destroy();
  console.log(chalk.green('Session locked'));
}

async function describeHomeState(): Promise<{ title: string; locked: boolean; sessionEnabled: boolean }> {
  const config = await loadConfig(process.cwd());
  if (config.encryption?.enabled === false) {
    return { title: 'EnvCP (ready)', locked: false, sessionEnabled: false };
  }
  if (config.session?.enabled === false) {
    return { title: 'EnvCP (password each time)', locked: false, sessionEnabled: false };
  }
  const locked = !await pathExists(resolveSessionPath(process.cwd(), config));
  return {
    title: locked ? 'EnvCP (locked)' : 'EnvCP (session active)',
    locked,
    sessionEnabled: true,
  };
}

const HOME_MENU_ACTIONS: Record<string, () => Promise<void>> = {
  unlock: () => runUnlockFlow(),
  lock: () => runLockFlow(),
  add: () => runAddSecretFlow(),
  setup: () => runConfigMenu(),
  config: () => runConfigMenu(),
  rules: () => runRuleMenu(),
};

async function runInteractiveHome(): Promise<void> {
  if (!await isProjectInitialized()) {
    console.log(chalk.yellow('EnvCP is not set up yet in this folder.'));
    await runInitFlow();
    return;
  }

  while (true) {
    const homeState = await describeHomeState();
    const lockLabel = homeState.locked ? 'Unlock' : 'Lock';
    const lockValue = homeState.locked ? 'unlock' : 'lock';
    const choices = [
      ...(homeState.sessionEnabled ? [{ label: lockLabel, value: lockValue }] : []),
      { label: 'Add secret', value: 'add' },
      { label: 'Setup project', value: 'setup' },
      { label: 'Config', value: 'config' },
      { label: 'Rules', value: 'rules' },
      { label: 'Exit', value: 'exit' },
    ];
    const choice = await promptMenu(homeState.title, choices, choices[0].value);

    if (choice === 'exit') {
      return;
    }

    const action = HOME_MENU_ACTIONS[choice];
    if (action) {
      await action();
    }
  }
}

const program = new Command();

program
  .name('envcp')
  .description('Secure environment variable management for AI-assisted coding')
  .version(VERSION);

program
  .command('init')
  .description('Set up EnvCP for first-time use')
  .option('-p, --project <name>', 'Project name')
  .option('--no-encrypt', 'Skip encryption (passwordless mode)')
  .option('--skip-env', 'Skip .env auto-import')
  .option('--skip-mcp', 'Skip MCP auto-registration')
  .option('--auth-method <method>', 'Authentication method: password | keychain | hsm | multi (default: password)')
  .option('--hsm-type <type>', 'HSM type for --auth-method hsm|multi: yubikey | gpg | pkcs11')
  .option('--key-id <id>', 'GPG key ID or PKCS#11 key label for HSM auth')
  .option('--pkcs11-lib <path>', 'Path to PKCS#11 shared library for --hsm-type pkcs11')
  .action(async (options) => {
    await runInitFlow(options);
  });

program
  .command('setup')
  .description('Set up or reconfigure the current project')
  .action(async () => {
    if (!await isProjectInitialized()) {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      if (path.resolve(process.cwd()) === path.resolve(home)) {
        console.log(chalk.yellow('envcp setup configures a project folder.'));
        console.log(chalk.gray('Open your project first, then run `envcp setup`.'));
        return;
      }
      await runInitFlow();
      return;
    }
    await runConfigMenu();
  });

program
  .command('unlock')
  .description('Unlock EnvCP session with password')
  .option('--recovery-key <key>', 'Recovery key to clear permanent lockout')
  .option('--save-to-keychain', 'Save password to OS keychain for auto-unlock')
  .option('--setup-hsm', 'Protect vault password with hardware security module')
  .option('--hsm-type <type>', 'HSM type: yubikey | gpg | pkcs11 (default: yubikey)')
  .option('--key-id <id>', 'GPG key ID or PKCS#11 key label')
  .option('--pkcs11-lib <path>', 'Path to PKCS#11 shared library (.so / .dll)')
  .option('--global', 'Unlock the global vault at ~/.envcp')
  .action(async (options) => {
    await runUnlockFlow(options);
  });

program
  .command('lock')
  .description('Lock EnvCP session')
  .option('--global', 'Lock the global vault session at ~/.envcp/.session')
  .action(async (options) => {
    await runLockFlow(!!options.global);
  });

program
  .command('status')
  .description('Check session status')
  .option('--global', 'Check status of the global vault session at ~/.envcp/.session')
  .action(async (options) => {
    const { projectPath, config } = await resolveCliContext(options.global ? 'global' : undefined);

    if (config.encryption?.enabled === false) {
      console.log(chalk.green('Ready'));
      console.log(chalk.gray('  Encryption is off, so no unlock is needed.'));
      return;
    }

    if (config.session?.enabled === false) {
      console.log(chalk.yellow('Session mode is off'));
      console.log(chalk.gray('  EnvCP will ask for the password each time.'));
      return;
    }

    const sessionManager = new SessionManager(
      resolveSessionPath(projectPath, config),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );

    await sessionManager.init();

    const password = await promptPassword('Enter password:');
    const session = await sessionManager.load(password);

    if (!session) {
      console.log(chalk.yellow('No active session (expired, invalid password, or not unlocked)'));
      console.log(chalk.gray('Run: envcp unlock'));
      return;
    }

    const remaining = sessionManager.getRemainingTime();
    const maxExt = config.session?.max_extensions || 5;

    console.log(chalk.green('Session active'));
    console.log(chalk.gray(`  Session ID: ${session.id}`));
console.log(chalk.gray(` Remaining: ${remaining} minutes`));
  console.log(chalk.gray(` Extensions remaining: ${maxExt - session.extensions}/${maxExt}`));
});

const configCommand = program
  .command('config')
  .description('Configure EnvCP settings')
  .action(async () => {
    await runConfigMenu();
  });

configCommand
  .command('reload')
  .description('Reload config from envcp.yaml (requires password)')
  .action(async () => {
    const projectPath = process.cwd();
    const configGuard = new ConfigGuard(projectPath);
    const password = await promptPassword('Enter password to reload config:');
    const result = await configGuard.reload(password);

    if (result.success) {
      console.log(chalk.green('Config reloaded successfully'));
      console.log(chalk.gray(`  New config hash: ${configGuard.getHash()?.substring(0, 16)}...`));
    } else {
      console.log(chalk.red(result.error || 'Failed to reload config'));
    }
  });

const ruleCommand = program
  .command('rule')
  .description('Manage EnvCP AI access rules')
  .action(async () => {
    await runRuleMenu();
  });

interface RuleScopeConfigs {
  scope: 'merged' | 'project' | 'home';
  config: EnvCPConfig;
  projectConfig: EnvCPConfig | null;
  homeConfig: EnvCPConfig | null;
}

function buildMergedOriginFn(scope: RuleScopeConfigs['scope']): (val: boolean, proj: boolean, home: boolean) => string {
  const formatOrigin = (origin: string) => scope === 'merged' ? ` (${origin})` : '';
  return (val, proj, home) =>
    formatOrigin(scope === 'merged' ? describeMergedDefaultOrigin(val, proj, home) : scope);
}

function printDefaultRuleLines(scopes: RuleScopeConfigs): void {
  const { config, projectConfig, homeConfig } = scopes;
  const mergedOrigin = buildMergedOriginFn(scopes.scope);
  const access = config.access;
  const projAccess = projectConfig?.access;
  const homeAccess = homeConfig?.access;

  const fields: Array<{ label: string; value: boolean; proj: boolean; home: boolean; on: string; off: string }> = [
    { label: 'read',           value: access.allow_ai_read,         proj: projAccess?.allow_ai_read ?? access.allow_ai_read,         home: homeAccess?.allow_ai_read ?? access.allow_ai_read,         on: 'allow', off: 'deny' },
    { label: 'write',          value: access.allow_ai_write,        proj: projAccess?.allow_ai_write ?? access.allow_ai_write,        home: homeAccess?.allow_ai_write ?? access.allow_ai_write,        on: 'allow', off: 'deny' },
    { label: 'delete',         value: access.allow_ai_delete,       proj: projAccess?.allow_ai_delete ?? access.allow_ai_delete,       home: homeAccess?.allow_ai_delete ?? access.allow_ai_delete,       on: 'allow', off: 'deny' },
    { label: 'export',         value: access.allow_ai_export,       proj: projAccess?.allow_ai_export ?? access.allow_ai_export,       home: homeAccess?.allow_ai_export ?? access.allow_ai_export,       on: 'allow', off: 'deny' },
    { label: 'run',            value: access.allow_ai_execute,      proj: projAccess?.allow_ai_execute ?? access.allow_ai_execute,      home: homeAccess?.allow_ai_execute ?? access.allow_ai_execute,      on: 'allow', off: 'deny' },
    { label: 'list names',     value: access.allow_ai_active_check, proj: projAccess?.allow_ai_active_check ?? access.allow_ai_active_check, home: homeAccess?.allow_ai_active_check ?? access.allow_ai_active_check, on: 'allow', off: 'deny' },
    { label: 'confirmation',   value: access.require_confirmation,  proj: projAccess?.require_confirmation ?? access.require_confirmation,   home: homeAccess?.require_confirmation ?? access.require_confirmation,   on: 'on', off: 'off' },
  ];

  for (const field of fields) {
    const label = field.value ? field.on : field.off;
    console.log(chalk.gray(`  Default ${field.label}: ${label}${mergedOrigin(field.value, field.proj, field.home)}`));
  }
}

function printVariableRulesSection(scopes: RuleScopeConfigs): void {
  const { scope, config, projectConfig, homeConfig } = scopes;
  const variableRules = Object.entries(config.access.variable_rules || {});
  if (variableRules.length === 0) {
    console.log(chalk.gray('  Variable rules: none'));
    return;
  }
  console.log(chalk.gray('  Variable rules:'));
  for (const [name, rule] of variableRules) {
    const origin = scope === 'merged'
      ? describeMergedVariableRuleOrigin(
        name,
        rule,
        projectConfig!.access.variable_rules || {},
        homeConfig!.access.variable_rules || {},
      )
      : scope;
    console.log(chalk.gray(`    ${name} [${origin}]`));
    for (const line of formatVariableRuleLines(rule)) {
      console.log(chalk.gray(`      ${line}`));
    }
  }
}

function printClientRulesSection(scopes: RuleScopeConfigs): void {
  const { scope, config, projectConfig, homeConfig } = scopes;
  const clientRules = Object.entries(config.access.client_rules || {});
  if (clientRules.length === 0) {
    console.log(chalk.gray('  Who rules: none'));
    return;
  }

  console.log(chalk.gray('  Who rules:'));
  for (const [clientId, rule] of clientRules) {
    const origin = scope === 'merged'
      ? describeMergedClientRuleOrigin(
        clientId,
        rule,
        projectConfig!.access.client_rules || {},
        homeConfig!.access.client_rules || {},
      )
      : scope;
    console.log(chalk.gray(`    ${formatClientLabel(clientId)} [${origin}]`));
    for (const line of formatClientRuleLines(rule)) {
      console.log(chalk.gray(`      ${line}`));
    }

    const variableRules = Object.entries(rule.variable_rules || {});
    if (variableRules.length === 0) continue;
    console.log(chalk.gray('      variable rules:'));
    for (const [name, variableRule] of variableRules) {
      console.log(chalk.gray(`        ${name}`));
      for (const line of formatVariableRuleLines(variableRule)) {
        console.log(chalk.gray(`          ${line}`));
      }
    }
  }
}

async function runRuleListCommand(options: { scope?: string }): Promise<void> {
  const scope = parseRuleScope(options.scope, 'merged');
  const config = await loadScopedConfig(process.cwd(), scope);
  const projectConfig = scope === 'merged' ? await loadScopedConfig(process.cwd(), 'project') : null;
  const homeConfig = scope === 'merged' ? await loadScopedConfig(process.cwd(), 'home') : null;

  console.log(chalk.blue('EnvCP rules'));
  console.log(chalk.gray(`  Scope: ${scope}`));

  const scopes: RuleScopeConfigs = { scope, config, projectConfig, homeConfig };
  printDefaultRuleLines(scopes);
  printVariableRulesSection(scopes);
  printClientRulesSection(scopes);

  if (scope === 'merged') {
    console.log(chalk.gray('  Tip: use `envcp rule set-default ... --who <id>` or `envcp rule set-variable ... --who <id>` to edit one client.'));
  }
}

ruleCommand
  .command('list')
  .description('List default, variable-specific, and who-specific AI rules')
  .option('--scope <scope>', 'Rule scope: merged | project | home', 'merged')
  .action(async (options) => {
    await runRuleListCommand(options);
  });

ruleCommand
  .command('set-default <operation> <mode>')
  .description('Set a default AI rule, e.g. read allow | list deny | confirm allow')
  .option('--scope <scope>', 'Rule scope: project | home', 'project')
  .option('--who <who>', 'Target one client id, e.g. mcp | openai | gemini | api | cursor')
  .action(async (operation, mode, options) => {
    const field = parseDefaultRuleField(operation);
    if (!field) {
      throw new Error(`Unknown rule operation '${operation}'`);
    }
    if (!['allow', 'deny', 'inherit'].includes(mode)) {
      throw new Error(`Rule mode must be 'allow', 'deny', or 'inherit', got '${mode}'`);
    }

    const scope = parseRuleScope(options.scope, 'project');
    if (scope === 'merged') {
      throw new Error('set-default cannot write to merged scope. Use project or home.');
    }
    if (mode === 'inherit' && !options.who) {
      throw new Error('inherit is only supported with --who. Global defaults must be allow or deny.');
    }
    const config = await loadScopedConfig(process.cwd(), scope);
    applyDefaultRule(config, field, mode === 'inherit' ? undefined : mode === 'allow', options.who);
    await saveScopedConfig(config, process.cwd(), scope);
    const target = options.who ? ` for ${options.who}` : '';
    console.log(chalk.green(`Default ${operation} rule set to ${mode}${target} in ${scope} scope`));
  });

ruleCommand
  .command('set-variable <name> <operation> <mode>')
  .description('Set a variable-specific AI rule, e.g. OPENAI_API_KEY run deny')
  .option('--scope <scope>', 'Rule scope: project | home', 'project')
  .option('--who <who>', 'Target one client id, e.g. mcp | openai | gemini | api | cursor')
  .action(async (name, operation, mode, options) => {
    const field = parseVariableRuleField(operation);
    if (!field) {
      throw new Error(`Unknown rule operation '${operation}'`);
    }
    if (!['allow', 'deny', 'inherit'].includes(mode)) {
      throw new Error(`Rule mode must be 'allow', 'deny', or 'inherit', got '${mode}'`);
    }

    const scope = parseRuleScope(options.scope, 'project');
    if (scope === 'merged') {
      throw new Error('set-variable cannot write to merged scope. Use project or home.');
    }
    const config = await loadScopedConfig(process.cwd(), scope);
    updateVariableRule(config, name, field, mode === 'inherit' ? undefined : mode === 'allow', options.who);
    await saveScopedConfig(config, process.cwd(), scope);
    const target = options.who ? ` for ${options.who}` : '';
    console.log(chalk.green(`Variable rule for ${name} ${operation} set to ${mode}${target} in ${scope} scope`));
  });

ruleCommand
  .command('set-window <name> <start> <end>')
  .description('Set an active time window for a variable rule, e.g. OPENAI_API_KEY 09:00 18:00')
  .option('--scope <scope>', 'Rule scope: project | home', 'project')
  .option('--who <who>', 'Target one client id, e.g. mcp | openai | gemini | api | cursor')
  .action(async (name, start, end, options) => {
    const scope = parseRuleScope(options.scope, 'project');
    if (scope === 'merged') {
      throw new Error('set-window cannot write to merged scope. Use project or home.');
    }
    const config = await loadScopedConfig(process.cwd(), scope);
    setVariableRuleWindow(config, name, start, end, options.who);
    await saveScopedConfig(config, process.cwd(), scope);
    const target = options.who ? ` for ${options.who}` : '';
    console.log(chalk.green(`Variable rule window for ${name} set to ${start}-${end}${target} in ${scope} scope`));
  });

ruleCommand
  .command('clear-window <name>')
  .description('Clear the active time window for a variable rule')
  .option('--scope <scope>', 'Rule scope: project | home', 'project')
  .option('--who <who>', 'Target one client id, e.g. mcp | openai | gemini | api | cursor')
  .action(async (name, options) => {
    const scope = parseRuleScope(options.scope, 'project');
    if (scope === 'merged') {
      throw new Error('clear-window cannot write to merged scope. Use project or home.');
    }
    const config = await loadScopedConfig(process.cwd(), scope);
    setVariableRuleWindow(config, name, undefined, undefined, options.who);
    await saveScopedConfig(config, process.cwd(), scope);
    const target = options.who ? ` for ${options.who}` : '';
    console.log(chalk.green(`Cleared variable rule window for ${name}${target} in ${scope} scope`));
  });

ruleCommand
  .command('remove-variable <name>')
  .description('Remove all variable-specific rules for one variable')
  .option('--scope <scope>', 'Rule scope: project | home', 'project')
  .option('--who <who>', 'Target one client id, e.g. mcp | openai | gemini | api | cursor')
  .action(async (name, options) => {
    const scope = parseRuleScope(options.scope, 'project');
    if (scope === 'merged') {
      throw new Error('remove-variable cannot write to merged scope. Use project or home.');
    }
    const config = await loadScopedConfig(process.cwd(), scope);
    if (options.who) {
      const clientRule = getClientRule(config, options.who);
      const nextVariableRules = { ...clientRule.variable_rules };
      delete nextVariableRules[name];
      clientRule.variable_rules = nextVariableRules;
      saveClientRule(config, options.who, clientRule);
    } else {
      const nextRules = { ...config.access.variable_rules };
      delete nextRules[name];
      config.access.variable_rules = nextRules;
    }
    await saveScopedConfig(config, process.cwd(), scope);
    const target = options.who ? ` for ${options.who}` : '';
    console.log(chalk.green(`Removed variable-specific rules for ${name}${target} in ${scope} scope`));
  });

program
  .command('extend')
  .description('Extend session timeout')
  .option('--global', 'Extend the global vault session at ~/.envcp/.session')
  .action(async (options) => {
    const { projectPath, config } = await resolveCliContext(options.global ? 'global' : undefined);

    const sessionManager = new SessionManager(
      resolveSessionPath(projectPath, config),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );

    await sessionManager.init();

    const password = await promptPassword('Enter password:');
    const loaded = await sessionManager.load(password);

    if (!loaded) {
      console.log(chalk.red('Cannot extend session. No active session or invalid password.'));
      return;
    }

    const session = await sessionManager.extend();

    if (!session) {
      console.log(chalk.red('Cannot extend session. Session expired or max extensions reached.'));
      return;
    }

    const maxExt = config.session?.max_extensions || 5;

    console.log(chalk.green('Session extended!'));
    console.log(chalk.gray(`  Remaining: ${sessionManager.getRemainingTime()} minutes`));
    console.log(chalk.gray(`  Extensions remaining: ${maxExt - session.extensions}/${maxExt}`));
  });

program
  .command('recover')
  .description('Recover access using recovery key (reset password)')
  .action(async () => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);

    if (config.security?.mode === 'hard-lock') {
      console.log(chalk.red('Recovery is not available in hard-lock mode.'));
      console.log(chalk.gray('Hard-lock mode means lost password = lost data.'));
      return;
    }

    const recoveryPath = path.join(projectPath, config.security?.recovery_file || '.envcp/.recovery');
    if (!await pathExists(recoveryPath)) {
      console.log(chalk.red('No recovery file found. Recovery is not available.'));
      return;
    }

    const recoveryKey = await promptPassword('Enter your recovery key:');

    const recoveryData = await fs.readFile(recoveryPath, 'utf8');

    let oldPassword: string;
    try {
      oldPassword = await recoverPassword(recoveryData, recoveryKey);
    } catch {
      console.log(chalk.red('Invalid recovery key.'));
      return;
    }

    // Verify old password actually works by loading the store
    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );
    storage.setPassword(oldPassword);

    let variables: Record<string, Variable>;
    try {
      variables = await storage.load();
    } catch {
      console.log(chalk.red('Recovery key decrypted but store could not be loaded. Data may be corrupted.'));
      return;
    }

    console.log(chalk.green('Recovery key verified. Store contains ' + Object.keys(variables).length + ' variables.'));

    // Set new password
    const newPassword = await promptPassword('Set new password:');
    const confirmPassword = await promptPassword('Confirm new password:');

    if (newPassword !== confirmPassword) {
      console.log(chalk.red('Passwords do not match'));
      return;
    }

    // Re-encrypt store with new password
    storage.invalidateCache();
    storage.setPassword(newPassword);
    await storage.save(variables);

    // Update recovery file with new password
    const newRecoveryKey = generateRecoveryKey();
    const newRecoveryData = await createRecoveryData(newPassword, newRecoveryKey);
    await fs.writeFile(recoveryPath, newRecoveryData, 'utf8');

    console.log(chalk.green('Password reset successfully!'));
    console.log('');
    console.log(chalk.yellow.bold('NEW RECOVERY KEY (save this somewhere safe!):'));
    console.log(chalk.yellow.bold(`  ${newRecoveryKey}`));
    console.log(chalk.gray('Your old recovery key no longer works.'));

    // Create a session with new password
    const sessionManager = new SessionManager(
      resolveSessionPath(projectPath, config),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );
    await sessionManager.init();
    await sessionManager.create(newPassword);

    console.log(chalk.green('Session unlocked with new password.'));
  });

program
  .command('verify')
  .description('Verify store integrity and check backups')
  .action(async () => {
    await withSession(async (storage, _password, config, projectPath) => {
      const result = await storage.verify();

      if (result.valid) {
        console.log(chalk.green('Store integrity: OK'));
        console.log(chalk.gray(`  Variables: ${result.count}`));
        console.log(chalk.gray(`  Backups: ${result.backups}`));

        // Check recovery file
        if (config.security?.mode === 'recoverable') {
          const recoveryPath = path.join(projectPath, config.security.recovery_file || '.envcp/.recovery');
          const hasRecovery = await pathExists(recoveryPath);
          console.log(chalk.gray(`  Recovery: ${hasRecovery ? 'available' : 'not found'}`));
        } else {
          console.log(chalk.gray(`  Recovery: hard-lock mode (disabled)`));
        }
      } else {
        console.log(chalk.red(`Store integrity: FAILED`));
        console.log(chalk.red(`  Error: ${result.error}`));

        if (result.backups && result.backups > 0) {
          console.log(chalk.yellow(`  ${result.backups} backup(s) available — store may auto-restore on next load`));
        }
      }
    });
  });

interface AddSourceOptions {
  value?: string;
  fromEnv?: string;
  fromFile?: string;
  stdin?: boolean;
}

interface ResolvedAddSource {
  value?: string;
  sourced: boolean;
}

function readSourceFlags(options: AddSourceOptions): string[] {
  const sourceFlags: string[] = [];
  if (options.value !== undefined) sourceFlags.push('--value');
  if (options.fromEnv !== undefined) sourceFlags.push('--from-env');
  if (options.fromFile !== undefined) sourceFlags.push('--from-file');
  if (options.stdin) sourceFlags.push('--stdin');
  return sourceFlags;
}

async function readStdinValue(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').replace(/\r?\n$/, '')));
    process.stdin.on('error', reject);
  });
}

async function resolveAddValueSource(options: AddSourceOptions): Promise<ResolvedAddSource> {
  if (options.value !== undefined) {
    if (process.stdout.isTTY) {
      console.warn(chalk.yellow('⚠  --value is visible in shell history and process list. Use --from-env, --from-file, or --stdin for secrets.'));
    }
    return { value: options.value, sourced: true };
  }

  if (options.fromEnv) {
    const envValue = process.env[options.fromEnv];
    if (envValue === undefined) {
      console.error(chalk.red(`Error: environment variable '${options.fromEnv}' is not set`));
      process.exit(1);
    }
    return { value: envValue, sourced: true };
  }

  if (options.fromFile) {
    try {
      const raw = await fs.readFile(options.fromFile, 'utf-8');
      return { value: raw.replace(/\r?\n$/, ''), sourced: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: cannot read '${options.fromFile}': ${msg}`));
      process.exit(1);
    }
  }

  if (options.stdin) {
    if (process.stdin.isTTY) {
      console.error(chalk.red('Error: --stdin requires piped input (e.g., `echo "$SECRET" | envcp add NAME --stdin`)'));
      process.exit(1);
    }
    return { value: await readStdinValue(), sourced: true };
  }

  return { value: undefined, sourced: false };
}

program
  .command('add <name>')
  .description('Add a new environment variable')
  .option('-v, --value <value>', 'Variable value (WARNING: leaks in shell history; prefer --from-env/--from-file/--stdin)')
  .option('--from-env <envVar>', 'Read value from the named environment variable')
  .option('--from-file <path>', 'Read value from a file (trailing newline trimmed)')
  .option('--stdin', 'Read value from piped stdin')
  .option('-t, --tags <tags>', 'Tags (comma-separated)')
  .option('-d, --description <desc>', 'Description')
  .action(async (name, options) => {
    const sourceFlags = readSourceFlags(options);

    if (sourceFlags.length > 1) {
      console.error(chalk.red(`Error: ${sourceFlags.join(', ')} are mutually exclusive — pick one`));
      process.exit(1);
    }

    const resolved = await resolveAddValueSource(options);
    let value = resolved.value;
    const sourced = resolved.sourced;

    await withSession(async (storage, _password, config) => {
      let tags: string[] = [];
      let description = options.description;

      if (!sourced) {
        value = await promptPassword('Enter value:');
        const tagsInput = await promptInput('Tags (comma-separated):');
        tags = tagsInput.split(',').map((t: string) => t.trim()).filter(Boolean);
        description = await promptInput('Description:');
      } else if (options.tags) {
        tags = options.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
      }

      if (value === undefined) {
        console.error(chalk.red('Error: no value provided'));
        process.exit(1);
      }

      const now = new Date().toISOString();
      const variable: Variable = {
        name,
        value,
        encrypted: config.storage.encrypted,
        tags: tags.length > 0 ? tags : undefined,
        description,
        created: now,
        updated: now,
        sync_to_env: true,
        protected: false,
      };

      await storage.set(name, variable);
      console.log(chalk.green(`Variable '${name}' added successfully`));
    });
  });

program
  .command('list')
  .description('List all variables (names only, values hidden)')
  .option('-v, --show-values', 'Show actual values')
   .action(async (options) => {
    await withSession(async (storage, _password, config) => {
      const variables = await storage.load();
      const names = Object.keys(variables);

      if (names.length === 0) {
        console.log(chalk.yellow('No variables found'));
        return;
      }

      console.log(chalk.blue(`\nVariables (${names.length}):\n`));

      for (const name of names) {
        const v = variables[name];
        const value = config.access?.mask_values && !options.showValues
          ? maskValue(v.value)
          : v.value;
        const tags = v.tags ? chalk.gray(` [${v.tags.join(', ')}]`) : '';
        console.log(`  ${chalk.cyan(name)} = ${value}${tags}`);
      }

      console.log('');
    });
  });

program
  .command('get <name>')
  .description('Get a variable value')
  .option('--show-value', 'Reveal the unmasked value')
  .action(async (name, options) => {
    await withSession(async (storage, _password, config) => {
      if (isBlacklisted(name, config)) {
        console.log(chalk.red(`Variable '${name}' is blacklisted and cannot be accessed`));
        return;
      }

      if (!canAccess(name, config)) {
        console.log(chalk.red(`Access denied to variable '${name}'`));
        return;
      }

      const variable = await storage.get(name);

      if (!variable) {
        console.log(chalk.red(`Variable '${name}' not found`));
        return;
      }

      const value = config.access?.mask_values && !options.showValue
        ? maskValue(variable.value)
        : variable.value;

      console.log(chalk.cyan(name));
      console.log(`  Value: ${value}`);
      if (variable.tags) console.log(`  Tags: ${variable.tags.join(', ')}`);
      if (variable.description) console.log(`  Description: ${variable.description}`);
    });
  });

program
  .command('remove <name>')
  .description('Remove a variable')
  .action(async (name) => {
    await withSession(async (storage) => {
      const deleted = await storage.delete(name);

      if (deleted) {
        console.log(chalk.green(`Variable '${name}' removed`));
      } else {
        console.log(chalk.red(`Variable '${name}' not found`));
      }
    });
  });

program
  .command('sync')
  .description('Sync variables to .env file')
  .option('--dry-run', 'Preview changes without writing')
  .action(async (options) => {
    await withSession(async (storage, _password, config, projectPath) => {
      if (!config.sync.enabled) {
        console.log(chalk.yellow('Sync is disabled in configuration'));
        return;
      }

      const variables = await storage.load();
      const lines: string[] = [];

      if (config.sync.header) {
        lines.push(config.sync.header);
      }

      for (const [name, variable] of Object.entries(variables)) {
        if (isBlacklisted(name, config) || !canAccess(name, config)) continue;
        if (!variable.sync_to_env) continue;

        const excluded = config.sync.exclude?.some((pattern: string) => globToRegExp(pattern).test(name));
        if (excluded) continue;

        lines.push(`${name}=${formatEnvAssignmentValue(variable.value)}`);
      }

      if (options.dryRun) {
        const envPath = path.join(projectPath, config.sync.target);
        const existing: Record<string, string> = {};
        if (await pathExists(envPath)) {
          const content = await fs.readFile(envPath, 'utf8');
          Object.assign(existing, parseEnvFile(content));
        }

        const newVars: string[] = [];
        const updated: string[] = [];
        const removed: string[] = [];

        for (const [name, variable] of Object.entries(variables)) {
          if (isBlacklisted(name, config) || !canAccess(name, config)) continue;
          if (!variable.sync_to_env) continue;

          const excluded = config.sync.exclude?.some((pattern: string) => globToRegExp(pattern).test(name));
          if (excluded) continue;

          if (name in existing) {
            if (existing[name] !== variable.value) updated.push(name);
          } else {
            newVars.push(name);
          }
        }

        const storeNames = new Set(Object.keys(variables));
        for (const name of Object.keys(existing)) {
          if (!storeNames.has(name)) removed.push(name);
        }

        console.log(chalk.blue(`Dry run: sync to ${config.sync.target}\n`));
        if (newVars.length > 0) {
          for (const n of newVars) console.log(chalk.green(`  + ${n} = ${maskValue(variables[n].value)}`));
        }
        if (updated.length > 0) {
          for (const n of updated) console.log(chalk.yellow(`  ~ ${n} = ${maskValue(variables[n].value)}`));
        }
        if (removed.length > 0) {
          for (const n of removed) console.log(chalk.red(`  - ${n}`));
        }
        if (newVars.length === 0 && updated.length === 0 && removed.length === 0) {
          console.log(chalk.gray('  No changes'));
        }
        console.log(chalk.gray('\nNo files were modified.'));
        return;
      }

      await fs.writeFile(path.join(projectPath, config.sync.target), lines.join('\n'), 'utf8');
      console.log(chalk.green(`Synced ${lines.length} variables to ${config.sync.target}`));
    });
  });

interface ServeContext {
  projectPath: string;
  forceGlobalMode: boolean;
}

async function resolveServeProjectPath(home: string, forceGlobal: boolean): Promise<ServeContext> {
  if (forceGlobal) {
    return { projectPath: home, forceGlobalMode: true };
  }
  const found = await findProjectRoot(process.cwd());
  if (found) {
    return { projectPath: found, forceGlobalMode: false };
  }
  const globalConfigPath = path.join(home, '.envcp', 'config.yaml');
  if (await pathExists(globalConfigPath)) {
    return { projectPath: home, forceGlobalMode: true };
  }
  process.stderr.write(
    'Error: No envcp.yaml found in cwd or any ancestor, and no global config at ~/.envcp/config.yaml.\n' +
    'Run `envcp init` (project) or `envcp init --global` first.\n'
  );
  process.exit(1);
}

async function ensureServePassword(
  config: EnvCPConfig,
  sessionPath: string,
  mode: string,
  forceGlobalMode: boolean,
): Promise<string | null> {
  const sessionManager = new SessionManager(
    sessionPath,
    config.session?.timeout_minutes || 30,
    config.session?.max_extensions || 5,
  );
  await sessionManager.init();

  const session = await sessionManager.load();
  if (!session) {
    if (mode === 'mcp') {
      process.stderr.write(`Error: No active session at ${sessionPath}. Run \`envcp unlock${forceGlobalMode ? ' --global' : ''}\` first.\n`);
      process.exit(1);
    }

    const password = await promptPassword('Enter password:');
    const { valid: passwordValid, warning: passwordWarning } = validatePassword(password, config.password || {});
    if (!passwordValid) {
      console.log(chalk.red('Invalid password'));
      return null;
    }
    if (passwordWarning) {
      console.log(chalk.yellow('⚠ Weak password detected'));
    }

    await sessionManager.create(password);
    return sessionManager.getPassword() || password;
  }

  return sessionManager.getPassword() || '';
}

async function maybeStartMcpServer(
  config: EnvCPConfig,
  projectPath: string,
  vaultPath: string,
  sessionPath: string,
  password: string | undefined,
): Promise<void> {
  const { EnvCPServer } = await import('../mcp/server.js');
  const server = new EnvCPServer(config, projectPath, password, vaultPath, sessionPath);
  await server.start();
}

function printServeEndpoints(mode: string): void {
  if (mode === 'auto' || mode === 'all') {
    console.log(chalk.gray('  REST API:     /api/*'));
    console.log(chalk.gray('  OpenAI:       /v1/chat/completions, /v1/functions/*'));
    console.log(chalk.gray('  Gemini:       /v1/models/envcp:generateContent'));
    console.log('');
    console.log(chalk.yellow('Auto-detection enabled: Server will detect client type from request headers'));
    return;
  }
  if (mode === 'rest') {
    console.log(chalk.gray('  GET    /api/variables       - List variables'));
    console.log(chalk.gray('  GET    /api/variables/:name - Get variable'));
    console.log(chalk.gray('  POST   /api/variables       - Create variable'));
    console.log(chalk.gray('  PUT    /api/variables/:name - Update variable'));
    console.log(chalk.gray('  DELETE /api/variables/:name - Delete variable'));
    console.log(chalk.gray('  POST   /api/sync            - Sync to .env'));
    console.log(chalk.gray('  POST   /api/tools/:name     - Call tool'));
    return;
  }
  if (mode === 'openai') {
    console.log(chalk.gray('  GET    /v1/models           - List models'));
    console.log(chalk.gray('  GET    /v1/functions        - List functions'));
    console.log(chalk.gray('  POST   /v1/functions/call   - Call function'));
    console.log(chalk.gray('  POST   /v1/tool_calls       - Process tool calls'));
    console.log(chalk.gray('  POST   /v1/chat/completions - Chat completions'));
    return;
  }
  if (mode === 'gemini') {
    console.log(chalk.gray('  GET    /v1/models           - List models'));
    console.log(chalk.gray('  GET    /v1/tools            - List tools'));
    console.log(chalk.gray('  POST   /v1/functions/call   - Call function'));
    console.log(chalk.gray('  POST   /v1/function_calls   - Process function calls'));
    console.log(chalk.gray('  POST   /v1/models/envcp:generateContent'));
  }
}

interface ServeOptions {
  mode: string;
  port: string;
  host: string;
  apiKey?: string;
  global?: boolean;
}

async function runServeCommand(options: ServeOptions): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const ctx = await resolveServeProjectPath(home, !!options.global);
  const { projectPath, forceGlobalMode } = ctx;

  const configGuard = new ConfigGuard(projectPath);
  const config = await configGuard.loadAndLock();
  if (forceGlobalMode) {
    config.vault = { ...config.vault, mode: 'global' };
  }

  const vaultPath = await resolveVaultPath(projectPath, config);
  const sessionPath = resolveSessionPath(projectPath, config);

  const mode = options.mode;
  const port = Number.parseInt(options.port, 10);
  const host = options.host;
  const apiKey = options.apiKey;

  let password = '';

  if (config.encryption?.enabled === false) {
    if (mode === 'mcp') {
      await maybeStartMcpServer(config, projectPath, vaultPath, sessionPath, undefined);
      return;
    }
  } else {
    const resolvedPassword = await ensureServePassword(config, sessionPath, mode, forceGlobalMode);
    if (resolvedPassword === null) return;
    password = resolvedPassword;

    if (mode === 'mcp') {
      await maybeStartMcpServer(config, projectPath, vaultPath, sessionPath, password);
      return;
    }
  }

  const { UnifiedServer } = await import('../server/unified.js');
  const serverConfig = {
    mode: mode as 'mcp' | 'rest' | 'openai' | 'gemini' | 'all' | 'auto',
    port,
    host,
    api_key: apiKey,
    cors: true,
    auto_detect: mode === 'auto',
    rate_limit: config.server?.rate_limit,
  };

  const server = new UnifiedServer(config, serverConfig, projectPath, password);

  console.log(chalk.blue('Starting EnvCP server...'));
  console.log(chalk.gray(`  Mode: ${mode}`));
  console.log(chalk.gray(`  Host: ${host}`));
  console.log(chalk.gray(`  Port: ${port}`));
  if (apiKey) console.log(chalk.gray(`  API Key: ${'*'.repeat(apiKey.length)}`));
  console.log('');

  await server.start();

  console.log(chalk.green(`EnvCP server running at http://${host}:${port}`));
  console.log('');
  console.log(chalk.blue('Available endpoints:'));
  printServeEndpoints(mode);

  console.log('');
  console.log(chalk.gray('Press Ctrl+C to stop'));
}

program
  .command('serve')
  .description('Start EnvCP server')
  .option('-m, --mode <mode>', 'Server mode: mcp, rest, openai, gemini, all, auto', 'auto')
  .option('--port <port>', 'HTTP port (for non-MCP modes)', '3456')
  .option('--host <host>', 'HTTP host', '127.0.0.1')
  .option('-k, --api-key <key>', 'API key for HTTP authentication')
  .option('--global', 'Force the global vault at ~/.envcp (skip project lookup)')
  .action(runServeCommand);

program
  .command('export')
  .description('Export variables')
  .option('-f, --format <format>', 'Output format: env, json, yaml', 'env')
  .option('--encrypted', 'Create an encrypted portable export file')
  .option('-o, --output <path>', 'Output file (required for --encrypted)')
  .action(async (options) => {
    await withSession(async (storage, _password, config) => {
      const variables = await storage.load();

      if (options.encrypted) {
        const outputPath = options.output;
        if (!outputPath) {
          console.log(chalk.red('--output <path> is required with --encrypted'));
          return;
        }

const exportPassword = await promptPassword('Set export password:');
    const confirmExport = await promptPassword('Confirm export password:');

    if (exportPassword !== confirmExport) {
          console.log(chalk.red('Passwords do not match'));
          return;
        }

        const exportData = JSON.stringify({
          meta: { project: config.project, timestamp: new Date().toISOString(), count: Object.keys(variables).length, version: '1.0' },
          variables,
        }, null, 2);

        const encrypted = await encrypt(exportData, exportPassword);
        await fs.writeFile(outputPath, encrypted, 'utf8');
        console.log(chalk.green(`Encrypted export saved to: ${outputPath}`));
        console.log(chalk.gray(`  Variables: ${Object.keys(variables).length}`));
        return;
      }

      let output: string;

      switch (options.format) {
        case 'json':
          output = JSON.stringify(variables, null, 2);
          break;
        case 'yaml': {
          const yaml = await import('js-yaml');
          output = yaml.dump(variables);
          break;
        }
        default: {
          const lines = Object.entries(variables).map(([k, v]) => {
            return `${k}=${formatEnvAssignmentValue(v.value)}`;
          });
          output = lines.join('\n');
        }
      }

      console.log(output);
    });
  });

program
  .command('import <file>')
  .description('Import variables from an encrypted export file')
  .option('--merge', 'Merge with existing variables (default: replace)')
  .option('--dry-run', 'Preview what would be imported without writing')
  .action(async (file, options) => {
    await withSession(async (storage) => {
      if (!await pathExists(file)) {
        console.log(chalk.red(`File not found: ${file}`));
        return;
      }

const importPassword = await promptPassword('Enter export file password:');

    const fileContent = await fs.readFile(file, 'utf8');
      let importData: Record<string, unknown>;

      try {
        const decrypted = await decrypt(fileContent, importPassword);
        importData = JSON.parse(decrypted);
      } catch {
        console.log(chalk.red('Failed to decrypt. Wrong password or invalid file.'));
        return;
      }

      const transferData = extractTransferVariables(importData, 'Invalid export format');
      if (!transferData) {
        return;
      }
      const { meta, variables } = transferData;

      logTransferInfo('Import info:', meta, variables, { project: 'From project', timestamp: 'Exported' });

      if (options.dryRun) {
        const current = await storage.load();
        const importNames = Object.keys(variables);

        console.log(chalk.blue(`\nDry run: import ${options.merge ? '(merge)' : '(replace)'}\n`));

        const newVars: string[] = [];
        const updated: string[] = [];

        for (const name of importNames) {
          if (name in current) {
            if (current[name].value !== variables[name].value) updated.push(name);
          } else {
            newVars.push(name);
          }
        }

        if (!options.merge) {
          const removed = Object.keys(current).filter(n => !importNames.includes(n));
          if (removed.length > 0) {
            for (const n of removed) console.log(chalk.red(`  - ${n} (will be removed)`));
          }
        }

        if (newVars.length > 0) {
          for (const n of newVars) console.log(chalk.green(`  + ${n} = ${maskValue(variables[n].value)}`));
        }
        if (updated.length > 0) {
          for (const n of updated) console.log(chalk.yellow(`  ~ ${n} = ${maskValue(variables[n].value)}`));
        }
        if (newVars.length === 0 && updated.length === 0) {
          console.log(chalk.gray('  No changes'));
        }
        console.log(chalk.gray('\nNo files were modified.'));
        return;
      }

const confirm = await promptConfirm(options.merge ? 'Merge into current store?' : 'Replace current store?', false);

    if (!confirm) {
      console.log(chalk.yellow('Import cancelled'));
        return;
      }

      if (options.merge) {
        const current = await storage.load();
        await storage.save({ ...current, ...variables });
        console.log(chalk.green(`Merged ${Object.keys(variables).length} variables`));
      } else {
        await storage.save(variables);
        console.log(chalk.green(`Imported ${Object.keys(variables).length} variables`));
      }
    });
  });

program
  .command('backup')
  .description('Create an encrypted backup of all variables')
  .option('-o, --output <path>', 'Output file path')
  .action(async (options) => {
    await withSession(async (storage, password, config, projectPath) => {
      const variables = await storage.load();
      const count = Object.keys(variables).length;

      if (count === 0) {
        console.log(chalk.yellow('No variables to backup'));
        return;
      }

      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
      const defaultPath = path.join(projectPath, `.envcp/backup-${timestamp}.enc`);
      const outputPath = options.output || defaultPath;

      const backupData = JSON.stringify({
        meta: {
          project: config.project,
          timestamp: new Date().toISOString(),
          count,
          version: '1.0',
        },
        variables,
      }, null, 2);

      const encrypted = await encrypt(backupData, password);
      await ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, encrypted, 'utf8');

      console.log(chalk.green(`Backup created: ${outputPath}`));
      console.log(chalk.gray(`  Variables: ${count}`));
      console.log(chalk.gray(`  Encrypted: yes`));
    });
  });

program
  .command('restore <file>')
  .description('Restore variables from an encrypted backup')
  .option('--merge', 'Merge with existing variables (default: replace)')
  .action(async (file, options) => {
    await withSession(async (storage, password) => {
      if (!await pathExists(file)) {
        console.log(chalk.red(`Backup file not found: ${file}`));
        return;
      }

      const encrypted = await fs.readFile(file, 'utf8');
      let backupData: Record<string, unknown>;

      try {
        const decrypted = await decrypt(encrypted, password);
        backupData = JSON.parse(decrypted);
      } catch {
        console.log(chalk.red('Failed to decrypt backup. Wrong password or corrupted file.'));
        return;
      }

      const transferData = extractTransferVariables(backupData, 'Invalid backup format');
      if (!transferData) {
        return;
      }
      const { meta, variables } = transferData;

      logTransferInfo('Backup info:', meta, variables, { project: 'Project', timestamp: 'Created' });

const confirm = await promptConfirm(options.merge ? 'Merge backup into current store?' : 'Replace current store with backup?', false);

    if (!confirm) {
      console.log(chalk.yellow('Restore cancelled'));
        return;
      }

      if (options.merge) {
        const current = await storage.load();
        const merged = { ...current, ...variables };
        await storage.save(merged);
        console.log(chalk.green(`Merged ${Object.keys(variables).length} variables from backup`));
      } else {
        await storage.save(variables);
        console.log(chalk.green(`Restored ${Object.keys(variables).length} variables from backup`));
      }
    });
  });

type DoctorCheck = { name: string; status: 'pass' | 'fail' | 'warn'; detail: string };

async function collectStoreFileCheck(projectPath: string, config: EnvCPConfig): Promise<DoctorCheck> {
  const storePath = path.join(projectPath, config.storage.path);
  if (!await pathExists(storePath)) {
    return { name: 'Store file', status: 'warn', detail: 'Not found (no variables stored yet)' };
  }
  const stat = await fs.stat(storePath);
  return { name: 'Store file', status: 'pass', detail: `Exists (${stat.size} bytes)` };
}

async function collectSessionCheck(projectPath: string, config: EnvCPConfig, encrypted: boolean): Promise<DoctorCheck> {
  if (!encrypted) {
    return { name: 'Session', status: 'pass', detail: 'Not needed (passwordless mode)' };
  }
  const sessionManager = new SessionManager(
    resolveSessionPath(projectPath, config),
    config.session?.timeout_minutes || 30,
    config.session?.max_extensions || 5,
  );
  await sessionManager.init();
  const session = await sessionManager.load();
  if (session) {
    const remaining = sessionManager.getRemainingTime();
    return { name: 'Session', status: 'pass', detail: `Active (${remaining}min remaining)` };
  }
  return { name: 'Session', status: 'warn', detail: 'No active session — run `envcp unlock`' };
}

async function collectRecoveryCheck(projectPath: string, config: EnvCPConfig): Promise<DoctorCheck | null> {
  if (config.security?.mode === 'recoverable') {
    const recoveryPath = path.join(projectPath, config.security.recovery_file || '.envcp/.recovery');
    if (await pathExists(recoveryPath)) {
      return { name: 'Recovery file', status: 'pass', detail: 'Present' };
    }
    return { name: 'Recovery file', status: 'warn', detail: 'Missing — password recovery will not work' };
  }
  if (config.security?.mode === 'hard-lock') {
    return { name: 'Recovery file', status: 'pass', detail: 'N/A (hard-lock mode)' };
  }
  return null;
}

async function collectEnvcpDirCheck(projectPath: string): Promise<DoctorCheck> {
  const envcpDir = path.join(projectPath, '.envcp');
  if (await pathExists(envcpDir)) {
    return { name: '.envcp directory', status: 'pass', detail: 'Exists' };
  }
  return { name: '.envcp directory', status: 'fail', detail: 'Missing — run `envcp init`' };
}

async function collectGitignoreCheck(projectPath: string): Promise<DoctorCheck> {
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (!await pathExists(gitignorePath)) {
    return { name: '.gitignore', status: 'warn', detail: 'No .gitignore found' };
  }
  const gitignore = await fs.readFile(gitignorePath, 'utf8');
  if (gitignore.includes('.envcp/')) {
    return { name: '.gitignore', status: 'pass', detail: '.envcp/ is ignored' };
  }
  return { name: '.gitignore', status: 'warn', detail: '.envcp/ not in .gitignore — secrets may be committed' };
}

async function collectMcpCheck(projectPath: string): Promise<DoctorCheck> {
  const mcpResult = await registerMcpConfig(projectPath);
  const totalMcp = mcpResult.registered.length + mcpResult.alreadyConfigured.length;
  if (totalMcp > 0) {
    return { name: 'MCP registration', status: 'pass', detail: `${mcpResult.alreadyConfigured.length} tool(s) configured` };
  }
  return { name: 'MCP registration', status: 'warn', detail: 'No AI tools detected' };
}

async function runDoctorChecks(projectPath: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  try {
    const config = await loadConfig(projectPath);
    const encrypted = config.encryption?.enabled !== false;

    checks.push(
      { name: 'Config', status: 'pass', detail: `Loaded (project: ${config.project || 'unnamed'})` },
      { name: 'Encryption', status: 'pass', detail: encrypted ? 'Enabled (AES-256-GCM)' : 'Disabled (passwordless)' },
      { name: 'Security mode', status: 'pass', detail: config.security?.mode ?? 'recoverable' },
      await collectStoreFileCheck(projectPath, config),
      await collectSessionCheck(projectPath, config, encrypted),
    );

    const recovery = await collectRecoveryCheck(projectPath, config);
    if (recovery) checks.push(recovery);

    checks.push(
      await collectEnvcpDirCheck(projectPath),
      await collectGitignoreCheck(projectPath),
      await collectMcpCheck(projectPath),
    );
  } catch (error) {
    checks.push({ name: 'Config', status: 'fail', detail: `Failed to load: ${(error as Error).message}` });
  }
  return checks;
}

function printDoctorSummary(checks: DoctorCheck[]): void {
  console.log(chalk.blue('\nEnvCP Doctor\n'));
  for (const check of checks) {
    let icon: string;
    if (check.status === 'pass') {
      icon = chalk.green('PASS');
    } else if (check.status === 'warn') {
      icon = chalk.yellow('WARN');
    } else {
      icon = chalk.red('FAIL');
    }
    console.log(`  [${icon}] ${check.name}: ${chalk.gray(check.detail)}`);
  }

  const fails = checks.filter(c => c.status === 'fail').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  console.log('');
  if (fails > 0) {
    console.log(chalk.red(`${fails} issue(s) need attention.`));
  } else if (warns > 0) {
    console.log(chalk.yellow(`All checks passed with ${warns} warning(s).`));
  } else {
    console.log(chalk.green('All checks passed.'));
  }
}

program
  .command('doctor')
  .description('Diagnose common issues and check system health')
  .action(async () => {
    const projectPath = process.cwd();
    const checks = await runDoctorChecks(projectPath);
    printDoctorSummary(checks);
  });

program
  .command('update')
  .description('Check for or install EnvCP updates')
  .option('-l, --latest', 'List and install latest stable versions')
  .option('-e, --experimental', 'List and install experimental versions')
  .option('-c, --canary', 'List and install canary versions')
  .option('--backup', 'Backup vault before installing')
  .action(async (options) => {
    const projectPath = process.cwd();
    const home = os.homedir();

    let channel: ReleaseChannel | null = null;
    if (options.latest) {
      channel = 'latest';
    } else if (options.experimental) {
      channel = 'experimental';
    } else if (options.canary) {
      channel = 'canary';
    }

    if (!channel) {
      // Original behaviour: just check and notify
      console.log(chalk.blue('Checking for updates...'));
      try {
        const info = await checkForUpdate(projectPath);
        const message = formatUpdateMessage(info);
        await logUpdateCheck(projectPath, info);
        if (info.updateAvailable) {
          console.log(info.critical ? chalk.red.bold(message) : chalk.yellow(message));
        } else {
          console.log(chalk.green(message));
        }
      } catch {
        console.log(chalk.yellow('Could not check for updates (offline or rate-limited)'));
      }
      return;
    }

    console.log(chalk.blue(`Fetching ${channel} releases...`));
    let releases;
    try {
      const all = await fetchReleases();
      releases = filterByChannel(all, channel).slice(0, 3);
    } catch {
      console.log(chalk.red('Could not fetch releases (offline or rate-limited)'));
      return;
    }

    if (releases.length === 0) {
      console.log(chalk.yellow(`No ${channel} releases found.`));
      return;
    }

    console.log(chalk.bold(`\n  Available ${channel} versions:\n`));
    releases.forEach((r, i) => {
      console.log(chalk.cyan(`  [${i + 1}] v${r.tag}`));
    });
    console.log(chalk.gray('\n  [0] Cancel\n'));

    const answer = await promptInput('Pick a version (0 to cancel):');
    const picked = Number.parseInt(answer.trim(), 10);
    if (!picked || picked < 1 || picked > releases.length) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }

    const chosen = releases[picked - 1];

    if (options.backup) {
      const backupPath = path.join(home, `.envcp.bak.${Date.now()}`);
      const vaultDir = path.join(home, '.envcp');
      const confirmed = await promptConfirm(`Backup ~/.envcp → ${backupPath}?`);
      if (confirmed) {
        try {
          await fs.cp(vaultDir, backupPath, { recursive: true });
          console.log(chalk.green(`  ✓ Backed up to ${backupPath}`));
        } catch (e) {
          console.log(chalk.red(`  Backup failed: ${(e as Error).message}`));
          return;
        }
      }
    }

    console.log(chalk.blue(`\nInstalling @fentz26/envcp@${chosen.tag}...`));
    const result = spawnSync('npm', ['install', '-g', `@fentz26/envcp@${chosen.tag}`], { stdio: 'inherit' });
    if (result.status === 0) {
      console.log(chalk.green(`\n  ✓ Installed v${chosen.tag}`));
    } else {
      console.log(chalk.red('\n  Installation failed.'));
    }
  });

async function switchVaultContext(name: string): Promise<void> {
  const projectPath = process.cwd();

  if (name !== 'global' && name !== 'project') {
    const vaultDir = path.join(projectPath, '.envcp/vaults', name);
    if (!await pathExists(vaultDir)) {
      console.log(chalk.red(`Named vault "${name}" does not exist. Create it with: envcp vault --name ${name} init`));
      return;
    }
  }

  await setActiveVault(projectPath, name);
  console.log(chalk.green(`Switched to vault: ${name}`));
}

async function listVaultContexts(): Promise<void> {
  const projectPath = process.cwd();
  const config = await loadConfig(projectPath);
  const vaults = await listVaults(projectPath, config);

  console.log('Available vaults:');
  for (const vault of vaults) {
    const active = vault.active ? chalk.green(' (active)') : '';
    const exists = await pathExists(vault.path);
    const status = exists ? '' : chalk.gray(' [not initialized]');
    console.log(`  ${vault.name}${active}${status}`);
    console.log(chalk.gray(`    ${vault.path}`));
  }
}

const vaultCommand = program
  .command('vault')
  .description('Manage vaults (global, project, or named)')
  .option('--global', 'Operate on the global vault')
  .option('--project', 'Operate on the project vault')
  .option('--name <name>', 'Operate on a named vault')
  .addCommand(
    new Command('init')
      .description('Initialize a vault')
      .action(async (_options, cmd) => {
        const parentOpts = cmd.parent.opts();
        const projectPath = process.cwd();
        const config = await loadConfig(projectPath);

        let vaultPath: string;
        let vaultName: string;
        
        if (parentOpts.global) {
          vaultPath = getGlobalVaultPath(config);
          vaultName = 'global';
        } else if (parentOpts.name) {
          vaultPath = await initNamedVault(projectPath, parentOpts.name);
          vaultName = parentOpts.name;
        } else {
          vaultPath = getProjectVaultPath(projectPath, config);
          vaultName = 'project';
        }
        
        const vaultDir = path.dirname(vaultPath);
        await ensureDir(vaultDir);
        console.log(chalk.green(`Vault "${vaultName}" initialized at ${vaultPath}`));
      })
  )
  .addCommand(
    new Command('add')
      .description('Add a variable to vault')
      .argument('<name>', 'Variable name')
      .option('-v, --value <value>', 'Variable value')
      .option('-t, --tags <tags>', 'Tags (comma-separated)')
      .action(async (name, options, cmd) => {
        const parentOpts = cmd.parent.opts();
        let vaultOverride: VaultOverride | undefined;
        if (parentOpts.global) {
          vaultOverride = 'global';
        } else if (parentOpts.project) {
          vaultOverride = 'project';
        }
        
        await withSession(async (storage) => {
          const value = options.value || await promptInput('Value:');
          const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];
          
          const now = new Date().toISOString();
          await storage.set(name, {
            name,
            value,
            encrypted: storage.encrypted,
            created: now,
            updated: now,
            sync_to_env: true,
            tags,
            protected: false,
          });
          console.log(chalk.green(`Variable '${name}' added to vault`));
        }, vaultOverride);
      })
  )
  .addCommand(
    new Command('list')
      .description('List vault contents')
      .option('-v, --show-values', 'Show actual values')
      .action(async (options, cmd) => {
        const parentOpts = cmd.parent.opts();
        let vaultOverride: VaultOverride | undefined;
        if (parentOpts.global) {
          vaultOverride = 'global';
        } else if (parentOpts.project) {
          vaultOverride = 'project';
        }
        
        await withSession(async (storage) => {
          const variables = await storage.load();
          const names = Object.keys(variables);
          if (names.length === 0) {
            console.log(chalk.gray('Vault is empty'));
            return;
          }
          for (const name of names) {
            const v = variables[name];
            const display = options.showValues ? v.value : maskValue(v.value);
            const tags = v.tags?.length ? ` [${v.tags.join(', ')}]` : '';
            console.log(`  ${name} = ${display}${tags}`);
          }
        }, vaultOverride);
      })
  )
  .addCommand(
    new Command('get')
      .description('Get a variable from vault')
      .argument('<name>', 'Variable name')
      .option('-v, --show-value', 'Show actual value')
      .action(async (name, options, cmd) => {
        const parentOpts = cmd.parent.opts();
        let vaultOverride: VaultOverride | undefined;
        if (parentOpts.global) {
          vaultOverride = 'global';
        } else if (parentOpts.project) {
          vaultOverride = 'project';
        }
        
        await withSession(async (storage) => {
          const v = await storage.get(name);
          if (!v) {
            console.log(chalk.red(`Variable '${name}' not found`));
            return;
          }
          const display = options.showValue ? v.value : maskValue(v.value);
          console.log(`${name} = ${display}`);
        }, vaultOverride);
      })
  )
  .addCommand(
    new Command('delete')
      .description('Delete a variable from vault')
      .argument('<name>', 'Variable name')
      .action(async (name, cmd) => {
        const parentOpts = cmd.parent.parent.opts();
        let vaultOverride: VaultOverride | undefined;
        if (parentOpts.global) {
          vaultOverride = 'global';
        } else if (parentOpts.project) {
          vaultOverride = 'project';
        }
        
        await withSession(async (storage) => {
          const deleted = await storage.delete(name);
          if (deleted) {
            console.log(chalk.green(`Variable '${name}' deleted`));
          } else {
            console.log(chalk.red(`Variable '${name}' not found`));
          }
        }, vaultOverride);
      })
  );

vaultCommand
  .addCommand(
    new Command('use')
      .description('Switch active vault context')
      .argument('<name>', 'Vault name (global, project, or named vault)')
      .action(async (name: string) => {
        await switchVaultContext(name);
      })
  )
  .addCommand(
    new Command('contexts')
      .description('List all available vaults')
      .action(async () => {
        await listVaultContexts();
      })
  );

program
  .command('keychain')
  .description('Manage OS keychain integration')
  .addCommand(
    new Command('status')
      .description('Check keychain availability and stored credentials')
      .action(async () => {
        const projectPath = process.cwd();
        const config = await loadConfig(projectPath);
        const keychain = new KeychainManager(config.keychain?.service || 'envcp');
        const status = await keychain.getStatus(projectPath);

        console.log(chalk.bold('Keychain Status'));
        console.log(chalk.gray(`  Backend:    ${status.backend}`));
        console.log(chalk.gray(`  Available:  ${status.available ? chalk.green('yes') : chalk.red('no')}`));
        console.log(chalk.gray(`  Stored:     ${status.hasPassword ? chalk.green('yes') : chalk.yellow('no')}`));
        console.log(chalk.gray(`  Enabled:    ${config.keychain?.enabled ? chalk.green('yes') : chalk.yellow('no')}`));

        if (!status.available) {
          console.log('');
          if (process.platform === 'linux') {
            console.log(chalk.yellow('Install libsecret: sudo apt install libsecret-tools'));
          } else if (process.platform === 'darwin') {
            console.log(chalk.yellow('macOS Keychain should be available by default'));
          }
        } else if (!status.hasPassword) {
          console.log('');
          console.log(chalk.gray('Run: envcp unlock --save-to-keychain'));
        }
      })
  )
  .addCommand(
    new Command('save')
      .description('Save current password to OS keychain')
      .action(async () => {
        await withSession(async (_storage, password, config, projectPath) => {
          if (!password) {
            console.log(chalk.red('No password available (encryption disabled?)'));
            return;
          }
          const keychain = new KeychainManager(config.keychain?.service || 'envcp');
          if (!await keychain.isAvailable()) {
            console.log(chalk.red(`OS keychain not available (${keychain.backendName})`));
            return;
          }
          const result = await keychain.storePassword(password, projectPath);
          if (result.success) {
            config.keychain = { ...config.keychain, enabled: true };
            await saveConfig(config, projectPath);
            console.log(chalk.green(`Password saved to ${keychain.backendName}`));
            console.log(chalk.gray('  Future sessions will auto-unlock from keychain'));
          } else {
            console.log(chalk.red(`Failed: ${result.error}`));
          }
        });
      })
  )
  .addCommand(
    new Command('remove')
      .description('Remove stored password from OS keychain')
      .action(async () => {
        const projectPath = process.cwd();
        const config = await loadConfig(projectPath);
        const keychain = new KeychainManager(config.keychain?.service || 'envcp');
        const result = await keychain.removePassword(projectPath);
        if (result.success) {
          config.keychain = { ...config.keychain, enabled: false };
          await saveConfig(config, projectPath);
          console.log(chalk.green('Password removed from keychain'));
        } else {
          console.log(chalk.yellow(`Nothing to remove or error: ${result.error}`));
        }
      })
  )
  .addCommand(
    new Command('disable')
      .description('Disable keychain auto-unlock (keeps stored credential)')
      .action(async () => {
        const projectPath = process.cwd();
        const config = await loadConfig(projectPath);
        config.keychain = { ...config.keychain, enabled: false };
        await saveConfig(config, projectPath);
        console.log(chalk.green('Keychain auto-unlock disabled'));
      })
  );

// Show welcome screen on first ever run
const firstRunMarker = path.join(os.homedir(), '.envcp', '.welcomed');
if (!await pathExists(firstRunMarker)) {
  await ensureDir(path.dirname(firstRunMarker));
  await fs.writeFile(firstRunMarker, new Date().toISOString());
  console.log(`
   ███████╗███╗   ██╗██╗   ██╗ ██████╗██████╗
   ██╔════╝████╗  ██║██║   ██║██╔════╝██╔══██╗
   █████╗  ██╔██╗ ██║██║   ██║██║     ██████╔╝
   ██╔══╝  ██║╚██╗██║╚██╗ ██╔╝██║     ██╔═══╝
   ███████╗██║ ╚████║ ╚████╔╝ ╚██████╗██║
   ╚══════╝╚═╝  ╚═══╝  ╚═══╝   ╚═════╝╚═╝

   Thanks for installing EnvCP!
   Keep your secrets safe from AI agents.

   ─────────────────────────────────────────────

   Vault location:

     ~/  or  /        ->  Global vault  (shared across all projects)
     any folder       ->  Project vault (named after the folder)
                          Rename anytime: envcp vault rename <name>

   ─────────────────────────────────────────────

   Get started:

     Simple (one-time setup):
       $ envcp init                        # Interactive guided setup

     Advanced (manual config):
       $ envcp init --advanced             # Full config options
       $ envcp add [NAME] [VALUE]          # Add a secret manually

     Explore:
       $ envcp --help                      # See all commands

   Docs: https://github.com/fentz26/EnvCP
`);
}

program
  .command('logs')
  .description('View audit logs')
  .option('--date <date>', 'Log date (YYYY-MM-DD, default: today)')
  .option('--operation <op>', 'Filter by operation (add, get, update, delete, list, sync, export, unlock, lock, check_access, run, auth_failure)')
  .option('--variable <name>', 'Filter by variable name')
  .option('--source <source>', 'Filter by source (cli, mcp, api)')
  .option('--success', 'Show only successful operations')
  .option('--failure', 'Show only failed operations')
  .option('--tail <n>', 'Show last N entries', (value) => Number.parseInt(value, 10))
  .option('--dates', 'List all available log dates')
  .option('--verify', 'Verify HMAC integrity of log entries')
  .action(async (options) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const logDir = resolveLogPath(config.audit, projectPath);
    const logs = new LogManager(logDir, config.audit);
    await logs.init();

    if (options.dates) {
      const dates = await logs.getLogDates();
      if (dates.length === 0) {
        console.log(chalk.gray('No log files found.'));
      } else {
        console.log(chalk.bold('Available log dates:'));
        dates.forEach(d => console.log(chalk.gray(`  ${d}`)));
      }
      return;
    }

    const filter: Record<string, unknown> = {};
    if (options.date) filter.date = options.date;
    if (options.operation) filter.operation = options.operation;
    if (options.variable) filter.variable = options.variable;
    if (options.source) filter.source = options.source;
    if (options.success) filter.success = true;
    if (options.failure) filter.success = false;
    if (options.tail) filter.tail = options.tail;

    const entries = await logs.getLogs(filter as Parameters<typeof logs.getLogs>[0]);

    if (entries.length === 0) {
      console.log(chalk.gray('No log entries found.'));
      return;
    }

    let failed = 0;
    entries.forEach(entry => {
      const ts = chalk.gray(entry.timestamp);
      const op = entry.success ? chalk.green(entry.operation) : chalk.red(entry.operation);
      const src = chalk.blue(entry.source);
      const varName = entry.variable ? chalk.yellow(` [${entry.variable}]`) : '';
      const msg = entry.message ? chalk.gray(` — ${entry.message}`) : '';

      if (options.verify && entry.hmac !== undefined) {
        const valid = logs.verifyEntry(entry);
        if (!valid) {
          failed++;
          console.log(`${ts} ${chalk.red('[TAMPERED]')} ${op} ${src}${varName}${msg}`);
          return;
        }
      }
      console.log(`${ts} ${op} ${src}${varName}${msg}`);
    });

    if (options.verify) {
      if (failed === 0) {
        console.log(chalk.green(`\nAll ${entries.length} entries verified OK.`));
      } else {
        console.log(chalk.red(`\n${failed}/${entries.length} entries failed HMAC verification.`));
      }
    }
  });

program
  .command('verify-logs')
  .description('Verify HMAC chain integrity of audit logs')
  .option('--date <date>', 'Verify specific date (YYYY-MM-DD, default: all dates)')
  .action(async (options) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const logDir = resolveLogPath(config.audit, projectPath);
    const logs = new LogManager(logDir, config.audit);
    await logs.init();

    if (!config.audit.hmac_chain) {
      console.log(chalk.yellow('HMAC chain is not enabled in audit config.'));
      return;
    }

    console.log(chalk.bold('Verifying log chain integrity...'));
    const result = await logs.verifyLogChain(options.date);

    if (result.valid) {
      console.log(chalk.green(`✓ Chain integrity verified: ${result.entries} entries OK`));
    } else {
      console.log(chalk.red(`✗ Chain integrity FAILED: ${result.tampered.length}/${result.entries} entries tampered`));
      console.log(chalk.red(`  Tampered indices: ${result.tampered.join(', ')}`));
    }
  });

program
  .command('protect-logs')
  .description('Apply OS-level protection to audit log files (Linux only)')
  .action(async () => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const logDir = resolveLogPath(config.audit, projectPath);
    const logs = new LogManager(logDir, config.audit);
    await logs.init();

    if (config.audit.protection === 'none') {
      console.log(chalk.yellow('Log protection is disabled in config (protection: none).'));
      return;
    }

    console.log(chalk.bold(`Applying ${config.audit.protection} protection to log files...`));
    const result = await logs.protectLogFiles();

    if (result.protected.length > 0) {
      console.log(chalk.green(`✓ Protected ${result.protected.length} files:`));
      result.protected.forEach((f: string) => console.log(chalk.gray(`  ${f}`)));
    }
    if (result.failed.length > 0) {
      console.log(chalk.red(`✗ Failed to protect ${result.failed.length} files:`));
      result.failed.forEach((f: string) => console.log(chalk.gray(`  ${f}`)));
    }
    if (result.protected.length === 0 && result.failed.length === 0) {
      console.log(chalk.gray('No log files to protect.'));
    }
  });

if (process.argv.length <= 2 && isInteractiveCli()) {
  await runInteractiveHome();
} else {
  await program.parseAsync(process.argv);
}
