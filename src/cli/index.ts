import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import * as path from 'path';
import * as os from 'os';
import fs from 'fs-extra';
import { loadConfig, initConfig, saveConfig, parseEnvFile, registerMcpConfig, isBlacklisted, canAccess } from '../config/manager.js';
import { StorageManager } from '../storage/index.js';
import { SessionManager } from '../utils/session.js';
import { maskValue, validatePassword, encrypt, decrypt, generateRecoveryKey, createRecoveryData, recoverPassword } from '../utils/crypto.js';
import { KeychainManager } from '../utils/keychain.js';
import { Variable, EnvCPConfig } from '../types.js';

async function withSession(fn: (storage: StorageManager, password: string, config: EnvCPConfig, projectPath: string) => Promise<void>): Promise<void> {
  const projectPath = process.cwd();
  const config = await loadConfig(projectPath);

  // Passwordless mode: no session, no password
  if (config.encryption?.enabled === false) {
    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      false
    );
    await fn(storage, '', config, projectPath);
    return;
  }

  const sessionManager = new SessionManager(
    path.join(projectPath, config.session?.path || '.envcp/.session'),
    config.session?.timeout_minutes || 30,
    config.session?.max_extensions || 5
  );
  await sessionManager.init();

  let session = await sessionManager.load();
  let password = '';

  if (!session) {
    // Try OS keychain first if enabled
    if (config.keychain?.enabled) {
      const keychain = new KeychainManager(config.keychain.service || 'envcp');
      const stored = await keychain.retrievePassword(projectPath);
      if (stored) {
        password = stored;
        console.log(chalk.gray('Password retrieved from OS keychain'));
      }
    }

    if (!password) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter password:', mask: '*' }
      ]);
      password = answer.password;

      const validation = validatePassword(password, config.password || {});
      if (!validation.valid) {
        console.log(chalk.red(validation.error));
        return;
      }
      if (validation.warning) {
        console.log(chalk.yellow(`⚠ ${validation.warning}`));
      }
    }

    session = await sessionManager.create(password);
  }

  password = sessionManager.getPassword() || password;

  const storage = new StorageManager(
    path.join(projectPath, config.storage.path),
    config.storage.encrypted
  );
  if (password) storage.setPassword(password);

  await fn(storage, password, config, projectPath);
}

const program = new Command();

program
  .name('envcp')
  .description('Secure environment variable management for AI-assisted coding')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize EnvCP in the current project')
  .option('-p, --project <name>', 'Project name')
  .option('--no-encrypt', 'Skip encryption (passwordless mode)')
  .option('--skip-env', 'Skip .env auto-import')
  .option('--skip-mcp', 'Skip MCP auto-registration')
  .action(async (options) => {
    const projectPath = process.cwd();
    const projectName = options.project || path.basename(projectPath);

    console.log(chalk.blue('Initializing EnvCP...'));
    console.log('');

    const config = await initConfig(projectPath, projectName);

    // Single security question (or skip if --no-encrypt)
    let securityChoice: 'none' | 'recoverable' | 'hard-lock';

    if (options.encrypt === false) {
      securityChoice = 'none';
    } else {
      const { mode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'mode',
          message: 'How would you like to secure your variables?',
          choices: [
            { name: 'No encryption (fastest setup, for local dev)', value: 'none' },
            { name: 'Encrypted with recovery key (recommended)', value: 'recoverable' },
            { name: 'Encrypted hard-lock (max security, no recovery)', value: 'hard-lock' },
          ],
          default: 'recoverable',
        }
      ]);
      securityChoice = mode;
    }

    // Apply security choice to config
    if (securityChoice === 'none') {
      config.encryption = { enabled: false };
      config.storage.encrypted = false;
      config.security = { mode: 'recoverable', recovery_file: '.envcp/.recovery' };
    } else {
      config.encryption = { enabled: true };
      config.storage.encrypted = true;
      config.security = { mode: securityChoice, recovery_file: '.envcp/.recovery' };
    }

    // For encrypted modes: get password now
    let pwd = '';
    if (securityChoice !== 'none') {
      const { password } = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Set encryption password:', mask: '*' }
      ]);
      const { confirm } = await inquirer.prompt([
        { type: 'password', name: 'confirm', message: 'Confirm password:', mask: '*' }
      ]);

      if (password !== confirm) {
        console.log(chalk.red('Passwords do not match. Aborting.'));
        return;
      }
      pwd = password;
    }

    await saveConfig(config, projectPath);

    const modeLabel = securityChoice === 'none' ? 'no encryption' : securityChoice;
    console.log(chalk.green('EnvCP initialized!'));
    console.log(chalk.gray(`  Project: ${config.project}`));
    console.log(chalk.gray(`  Security: ${modeLabel}`));
    if (securityChoice !== 'none') {
      console.log(chalk.gray(`  Session timeout: ${config.session?.timeout_minutes || 30} minutes`));
    }

    // Auto-import .env
    if (!options.skipEnv) {
      const envPath = path.join(projectPath, '.env');
      if (await fs.pathExists(envPath)) {
        const envContent = await fs.readFile(envPath, 'utf8');
        const vars = parseEnvFile(envContent);
        const count = Object.keys(vars).length;

        if (count > 0) {
          const storage = new StorageManager(
            path.join(projectPath, config.storage.path),
            config.storage.encrypted
          );
          if (pwd) storage.setPassword(pwd);

          const now = new Date().toISOString();
          for (const [name, value] of Object.entries(vars)) {
            await storage.set(name, {
              name, value,
              encrypted: config.storage.encrypted,
              created: now, updated: now,
              sync_to_env: true,
            });
          }

          // Create session for encrypted mode
          if (pwd) {
            const sessionManager = new SessionManager(
              path.join(projectPath, config.session?.path || '.envcp/.session'),
              config.session?.timeout_minutes || 30,
              config.session?.max_extensions || 5
            );
            await sessionManager.init();
            await sessionManager.create(pwd);
          }

          console.log(chalk.green(`  Imported ${count} variables from .env`));
          console.log(chalk.gray(`  Variables: ${Object.keys(vars).join(', ')}`));
        }
      }
    }

    // Generate recovery key for encrypted recoverable mode
    if (securityChoice === 'recoverable' && pwd) {
      const recoveryKey = generateRecoveryKey();
      const recoveryData = await createRecoveryData(pwd, recoveryKey);
      const recoveryPath = path.join(projectPath, config.security.recovery_file);
      await fs.writeFile(recoveryPath, recoveryData, 'utf8');

      console.log('');
      console.log(chalk.yellow.bold('  RECOVERY KEY (save this somewhere safe!):'));
      console.log(chalk.yellow.bold(`  ${recoveryKey}`));
      console.log(chalk.gray('  This key is shown ONCE. If you lose it, you cannot recover your password.'));
    }

    // Auto-register MCP in all detected tools
    if (!options.skipMcp) {
      const result = await registerMcpConfig(projectPath);
      console.log('');
      if (result.registered.length > 0) {
        console.log(chalk.green('  MCP registered:'));
        for (const name of result.registered) {
          console.log(chalk.gray(`    + ${name}`));
        }
      }
      if (result.alreadyConfigured.length > 0) {
        for (const name of result.alreadyConfigured) {
          console.log(chalk.gray(`    = ${name} (already configured)`));
        }
      }
      if (result.manual.length > 0) {
        console.log(chalk.gray('  Manual setup needed:'));
        for (const name of result.manual) {
          console.log(chalk.gray(`    ? ${name}`));
        }
      }
      if (result.registered.length === 0 && result.alreadyConfigured.length === 0) {
        console.log(chalk.gray('  No AI tools detected for auto-registration'));
      }
    }

    console.log('');
    console.log(chalk.green('Done! Your AI tools can now use EnvCP.'));
  });

program
  .command('unlock')
  .description('Unlock EnvCP session with password')
  .option('-p, --password <password>', 'Password (will prompt if not provided)')
  .option('--save-to-keychain', 'Save password to OS keychain for auto-unlock')
  .action(async (options) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    let password = options.password;
    
    if (!password) {
      const answer = await inquirer.prompt([
        { 
          type: 'password', 
          name: 'password', 
          message: 'Enter password:', 
          mask: '*' 
        }
      ]);
      password = answer.password;
    }

    const validation = validatePassword(password, config.password || {});
    if (!validation.valid) {
      console.log(chalk.red(validation.error));
      return;
    }
    if (validation.warning) {
      console.log(chalk.yellow(`⚠ ${validation.warning}`));
    }

    const sessionManager = new SessionManager(
      path.join(projectPath, config.session?.path || '.envcp/.session'),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );

    await sessionManager.init();
    
    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );
    storage.setPassword(password);

    const storeExists = await storage.exists();

    if (!storeExists) {
      const confirm = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Confirm password:', mask: '*' }
      ]);
      if (confirm.password !== password) {
        console.log(chalk.red('Passwords do not match'));
        return;
      }

      // Generate recovery key for new stores in recoverable mode
      if (config.security?.mode === 'recoverable') {
        const recoveryPath = path.join(projectPath, config.security.recovery_file || '.envcp/.recovery');
        if (!await fs.pathExists(recoveryPath)) {
          const recoveryKey = generateRecoveryKey();
          const recoveryData = await createRecoveryData(password, recoveryKey);
          await fs.ensureDir(path.dirname(recoveryPath));
          await fs.writeFile(recoveryPath, recoveryData, 'utf8');

          console.log('');
          console.log(chalk.yellow.bold('RECOVERY KEY (save this somewhere safe!):'));
          console.log(chalk.yellow.bold(`  ${recoveryKey}`));
          console.log(chalk.gray('This key is shown ONCE. If you lose it, you cannot recover your password.'));
          console.log('');
        }
      }
    }

    try {
      await storage.load();
    } catch (error) {
      console.log(chalk.red('Invalid password'));
      return;
    }

    const session = await sessionManager.create(password);

    console.log(chalk.green('Session unlocked!'));
    console.log(chalk.gray(`  Session ID: ${session.id}`));
    console.log(chalk.gray(`  Expires in: ${config.session?.timeout_minutes || 30} minutes`));
    const maxExt = config.session?.max_extensions || 5;
    console.log(chalk.gray(`  Extensions remaining: ${maxExt - session.extensions}/${maxExt}`));

    // Save to keychain if requested
    if (options.saveToKeychain) {
      const keychain = new KeychainManager(config.keychain?.service || 'envcp');
      if (await keychain.isAvailable()) {
        const result = await keychain.storePassword(password, projectPath);
        if (result.success) {
          // Enable keychain in config
          config.keychain = { ...config.keychain, enabled: true };
          await saveConfig(config, projectPath);
          console.log(chalk.green(`Password saved to ${keychain.backendName}`));
          console.log(chalk.gray('  Future sessions will auto-unlock from keychain'));
        } else {
          console.log(chalk.red(`Failed to save to keychain: ${result.error}`));
        }
      } else {
        console.log(chalk.red(`OS keychain not available (${keychain.backendName})`));
      }
    }
  });

program
  .command('lock')
  .description('Lock EnvCP session')
  .action(async () => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    const sessionManager = new SessionManager(
      path.join(projectPath, config.session?.path || '.envcp/.session'),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );

    await sessionManager.init();
    await sessionManager.destroy();
    
    console.log(chalk.green('Session locked'));
  });

program
  .command('status')
  .description('Check session status')
  .action(async () => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    const sessionManager = new SessionManager(
      path.join(projectPath, config.session?.path || '.envcp/.session'),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );

    await sessionManager.init();

    const answer = await inquirer.prompt([
      { type: 'password', name: 'password', message: 'Enter password:', mask: '*' }
    ]);
    const session = await sessionManager.load(answer.password);

    if (!session) {
      console.log(chalk.yellow('No active session (expired, invalid password, or not unlocked)'));
      console.log(chalk.gray('Run: envcp unlock'));
      return;
    }

    const remaining = sessionManager.getRemainingTime();
    const maxExt = config.session?.max_extensions || 5;

    console.log(chalk.green('Session active'));
    console.log(chalk.gray(`  Session ID: ${session.id}`));
    console.log(chalk.gray(`  Remaining: ${remaining} minutes`));
    console.log(chalk.gray(`  Extensions remaining: ${maxExt - session.extensions}/${maxExt}`));
  });

program
  .command('extend')
  .description('Extend session timeout')
  .action(async () => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    const sessionManager = new SessionManager(
      path.join(projectPath, config.session?.path || '.envcp/.session'),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );

    await sessionManager.init();

    const answer = await inquirer.prompt([
      { type: 'password', name: 'password', message: 'Enter password:', mask: '*' }
    ]);
    const loaded = await sessionManager.load(answer.password);

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
    if (!await fs.pathExists(recoveryPath)) {
      console.log(chalk.red('No recovery file found. Recovery is not available.'));
      return;
    }

    const { recoveryKey } = await inquirer.prompt([
      { type: 'password', name: 'recoveryKey', message: 'Enter your recovery key:', mask: '*' }
    ]);

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
    const { newPassword } = await inquirer.prompt([
      { type: 'password', name: 'newPassword', message: 'Set new password:', mask: '*' }
    ]);
    const { confirmPassword } = await inquirer.prompt([
      { type: 'password', name: 'confirmPassword', message: 'Confirm new password:', mask: '*' }
    ]);

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
      path.join(projectPath, config.session?.path || '.envcp/.session'),
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
          const hasRecovery = await fs.pathExists(recoveryPath);
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

program
  .command('add <name>')
  .description('Add a new environment variable')
  .option('-v, --value <value>', 'Variable value')
  .option('-t, --tags <tags>', 'Tags (comma-separated)')
  .option('-d, --description <desc>', 'Description')
  .action(async (name, options) => {
    await withSession(async (storage, _password, config) => {
      let value = options.value;
      let tags: string[] = [];
      let description = options.description;

      if (!value) {
        const answers = await inquirer.prompt([
          { type: 'password', name: 'value', message: 'Enter value:', mask: '*' },
          { type: 'input', name: 'tags', message: 'Tags (comma-separated):' },
          { type: 'input', name: 'description', message: 'Description:' },
        ]);
        value = answers.value;
        tags = answers.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
        description = answers.description;
      } else if (options.tags) {
        tags = options.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
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

        const excluded = config.sync.exclude?.some((pattern: string) => {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(name);
        });
        if (excluded) continue;

        const needsQuoting = /[\s#"'\\]/.test(variable.value);
        const val = needsQuoting ? `"${variable.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : variable.value;
        lines.push(`${name}=${val}`);
      }

      if (options.dryRun) {
        const envPath = path.join(projectPath, config.sync.target);
        const existing: Record<string, string> = {};
        if (await fs.pathExists(envPath)) {
          const content = await fs.readFile(envPath, 'utf8');
          Object.assign(existing, parseEnvFile(content));
        }

        const newVars: string[] = [];
        const updated: string[] = [];
        const removed: string[] = [];

        for (const [name, variable] of Object.entries(variables)) {
          if (isBlacklisted(name, config) || !canAccess(name, config)) continue;
          if (!variable.sync_to_env) continue;

          const excluded = config.sync.exclude?.some((pattern: string) => {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(name);
          });
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

program
  .command('serve')
  .description('Start EnvCP server')
  .option('-p, --password <password>', 'Encryption password')
  .option('-m, --mode <mode>', 'Server mode: mcp, rest, openai, gemini, all, auto', 'auto')
  .option('--port <port>', 'HTTP port (for non-MCP modes)', '3456')
  .option('--host <host>', 'HTTP host', '127.0.0.1')
  .option('-k, --api-key <key>', 'API key for HTTP authentication')
  .action(async (options) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    const mode = options.mode as string;
    const port = parseInt(options.port, 10);
    const host = options.host;
    const apiKey = options.apiKey;

    let password = options.password || '';

    // Passwordless mode: skip all session/password logic
    if (config.encryption?.enabled === false) {
      if (mode === 'mcp') {
        const { EnvCPServer } = await import('../mcp/server.js');
        const server = new EnvCPServer(config, projectPath);
        await server.start();
        return;
      }
    } else {
      // Encrypted mode: need password
      const sessionManager = new SessionManager(
        path.join(projectPath, config.session?.path || '.envcp/.session'),
        config.session?.timeout_minutes || 30,
        config.session?.max_extensions || 5
      );
      await sessionManager.init();

      let session = await sessionManager.load();

      if (!session && !password) {
        // MCP mode uses stdio — can't prompt interactively
        if (mode === 'mcp') {
          process.stderr.write('Error: No active session. Run `envcp unlock` first, or use --password flag.\n');
          process.exit(1);
        }

        const answer = await inquirer.prompt([
          { type: 'password', name: 'password', message: 'Enter password:', mask: '*' }
        ]);
        password = answer.password;

        const validation = validatePassword(password, config.password || {});
        if (!validation.valid) {
          console.log(chalk.red(validation.error));
          return;
        }
        if (validation.warning) {
          console.log(chalk.yellow(`⚠ ${validation.warning}`));
        }

        session = await sessionManager.create(password);
      }

      password = sessionManager.getPassword() || password;

      // MCP mode uses stdio
      if (mode === 'mcp') {
        const { EnvCPServer } = await import('../mcp/server.js');
        const server = new EnvCPServer(config, projectPath, password);
        await server.start();
        return;
      }
    }

    // HTTP-based modes
    const { UnifiedServer } = await import('../server/unified.js');
    
    const serverConfig = {
      mode: mode as 'mcp' | 'rest' | 'openai' | 'gemini' | 'all' | 'auto',
      port,
      host,
      api_key: apiKey,
      cors: true,
      auto_detect: mode === 'auto',
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
    
    if (mode === 'auto' || mode === 'all') {
      console.log(chalk.gray('  REST API:     /api/*'));
      console.log(chalk.gray('  OpenAI:       /v1/chat/completions, /v1/functions/*'));
      console.log(chalk.gray('  Gemini:       /v1/models/envcp:generateContent'));
      console.log('');
      console.log(chalk.yellow('Auto-detection enabled: Server will detect client type from request headers'));
    } else if (mode === 'rest') {
      console.log(chalk.gray('  GET    /api/variables       - List variables'));
      console.log(chalk.gray('  GET    /api/variables/:name - Get variable'));
      console.log(chalk.gray('  POST   /api/variables       - Create variable'));
      console.log(chalk.gray('  PUT    /api/variables/:name - Update variable'));
      console.log(chalk.gray('  DELETE /api/variables/:name - Delete variable'));
      console.log(chalk.gray('  POST   /api/sync            - Sync to .env'));
      console.log(chalk.gray('  POST   /api/tools/:name     - Call tool'));
    } else if (mode === 'openai') {
      console.log(chalk.gray('  GET    /v1/models           - List models'));
      console.log(chalk.gray('  GET    /v1/functions        - List functions'));
      console.log(chalk.gray('  POST   /v1/functions/call   - Call function'));
      console.log(chalk.gray('  POST   /v1/tool_calls       - Process tool calls'));
      console.log(chalk.gray('  POST   /v1/chat/completions - Chat completions'));
    } else if (mode === 'gemini') {
      console.log(chalk.gray('  GET    /v1/models           - List models'));
      console.log(chalk.gray('  GET    /v1/tools            - List tools'));
      console.log(chalk.gray('  POST   /v1/functions/call   - Call function'));
      console.log(chalk.gray('  POST   /v1/function_calls   - Process function calls'));
      console.log(chalk.gray('  POST   /v1/models/envcp:generateContent'));
    }
    
    console.log('');
    console.log(chalk.gray('Press Ctrl+C to stop'));
  });

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

        const { exportPassword } = await inquirer.prompt([
          { type: 'password', name: 'exportPassword', message: 'Set export password:', mask: '*' }
        ]);
        const { confirmExport } = await inquirer.prompt([
          { type: 'password', name: 'confirmExport', message: 'Confirm export password:', mask: '*' }
        ]);

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
            const needsQuoting = /[\s#"'\\]/.test(v.value);
            const val = needsQuoting ? `"${v.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v.value;
            return `${k}=${val}`;
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
      if (!await fs.pathExists(file)) {
        console.log(chalk.red(`File not found: ${file}`));
        return;
      }

      const { importPassword } = await inquirer.prompt([
        { type: 'password', name: 'importPassword', message: 'Enter export file password:', mask: '*' }
      ]);

      const fileContent = await fs.readFile(file, 'utf8');
      let importData: Record<string, unknown>;

      try {
        const decrypted = await decrypt(fileContent, importPassword);
        importData = JSON.parse(decrypted);
      } catch {
        console.log(chalk.red('Failed to decrypt. Wrong password or invalid file.'));
        return;
      }

      const meta = importData.meta as { project?: string; timestamp?: string; count?: number } | undefined;
      const variables = importData.variables as Record<string, Variable>;

      if (!variables || typeof variables !== 'object') {
        console.log(chalk.red('Invalid export format'));
        return;
      }

      if (meta) {
        console.log(chalk.blue('Import info:'));
        if (meta.project) console.log(chalk.gray(`  From project: ${meta.project}`));
        if (meta.timestamp) console.log(chalk.gray(`  Exported: ${meta.timestamp}`));
        console.log(chalk.gray(`  Variables: ${meta.count || Object.keys(variables).length}`));
      }

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

      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: options.merge ? 'Merge into current store?' : 'Replace current store?', default: false }
      ]);

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

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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
      await fs.ensureDir(path.dirname(outputPath));
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
      if (!await fs.pathExists(file)) {
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

      const meta = backupData.meta as { project?: string; timestamp?: string; count?: number } | undefined;
      const variables = backupData.variables as Record<string, Variable>;

      if (!variables || typeof variables !== 'object') {
        console.log(chalk.red('Invalid backup format'));
        return;
      }

      if (meta) {
        console.log(chalk.blue('Backup info:'));
        if (meta.project) console.log(chalk.gray(`  Project: ${meta.project}`));
        if (meta.timestamp) console.log(chalk.gray(`  Created: ${meta.timestamp}`));
        console.log(chalk.gray(`  Variables: ${meta.count || Object.keys(variables).length}`));
      }

      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: options.merge ? 'Merge backup into current store?' : 'Replace current store with backup?', default: false }
      ]);

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

program
  .command('doctor')
  .description('Diagnose common issues and check system health')
  .action(async () => {
    const projectPath = process.cwd();
    const checks: { name: string; status: 'pass' | 'fail' | 'warn'; detail: string }[] = [];

    // 1. Config check
    try {
      const config = await loadConfig(projectPath);
      checks.push({ name: 'Config', status: 'pass', detail: `Loaded (project: ${config.project || 'unnamed'})` });

      // 2. Encryption mode
      const encrypted = config.encryption?.enabled !== false;
      checks.push({ name: 'Encryption', status: 'pass', detail: encrypted ? 'Enabled (AES-256-GCM)' : 'Disabled (passwordless)' });

      // 3. Security mode
      checks.push({ name: 'Security mode', status: 'pass', detail: config.security?.mode || 'recoverable' });

      // 4. Store file
      const storePath = path.join(projectPath, config.storage.path);
      if (await fs.pathExists(storePath)) {
        const stat = await fs.stat(storePath);
        checks.push({ name: 'Store file', status: 'pass', detail: `Exists (${stat.size} bytes)` });
      } else {
        checks.push({ name: 'Store file', status: 'warn', detail: 'Not found (no variables stored yet)' });
      }

      // 5. Session status
      if (encrypted) {
        const sessionManager = new SessionManager(
          path.join(projectPath, config.session?.path || '.envcp/.session'),
          config.session?.timeout_minutes || 30,
          config.session?.max_extensions || 5
        );
        await sessionManager.init();
        const session = await sessionManager.load();
        if (session) {
          const remaining = sessionManager.getRemainingTime();
          checks.push({ name: 'Session', status: 'pass', detail: `Active (${remaining}min remaining)` });
        } else {
          checks.push({ name: 'Session', status: 'warn', detail: 'No active session — run `envcp unlock`' });
        }
      } else {
        checks.push({ name: 'Session', status: 'pass', detail: 'Not needed (passwordless mode)' });
      }

      // 6. Recovery file
      if (config.security?.mode === 'recoverable') {
        const recoveryPath = path.join(projectPath, config.security.recovery_file || '.envcp/.recovery');
        if (await fs.pathExists(recoveryPath)) {
          checks.push({ name: 'Recovery file', status: 'pass', detail: 'Present' });
        } else {
          checks.push({ name: 'Recovery file', status: 'warn', detail: 'Missing — password recovery will not work' });
        }
      } else if (config.security?.mode === 'hard-lock') {
        checks.push({ name: 'Recovery file', status: 'pass', detail: 'N/A (hard-lock mode)' });
      }

      // 7. .envcp directory
      const envcpDir = path.join(projectPath, '.envcp');
      if (await fs.pathExists(envcpDir)) {
        checks.push({ name: '.envcp directory', status: 'pass', detail: 'Exists' });
      } else {
        checks.push({ name: '.envcp directory', status: 'fail', detail: 'Missing — run `envcp init`' });
      }

      // 8. .gitignore check
      const gitignorePath = path.join(projectPath, '.gitignore');
      if (await fs.pathExists(gitignorePath)) {
        const gitignore = await fs.readFile(gitignorePath, 'utf8');
        if (gitignore.includes('.envcp/')) {
          checks.push({ name: '.gitignore', status: 'pass', detail: '.envcp/ is ignored' });
        } else {
          checks.push({ name: '.gitignore', status: 'warn', detail: '.envcp/ not in .gitignore — secrets may be committed' });
        }
      } else {
        checks.push({ name: '.gitignore', status: 'warn', detail: 'No .gitignore found' });
      }

      // 9. MCP registration
      const mcpResult = await registerMcpConfig(projectPath);
      const totalMcp = mcpResult.registered.length + mcpResult.alreadyConfigured.length;
      if (totalMcp > 0) {
        checks.push({ name: 'MCP registration', status: 'pass', detail: `${mcpResult.alreadyConfigured.length} tool(s) configured` });
      } else {
        checks.push({ name: 'MCP registration', status: 'warn', detail: 'No AI tools detected' });
      }

    } catch (error) {
      checks.push({ name: 'Config', status: 'fail', detail: `Failed to load: ${(error as Error).message}` });
    }

    // Print results
    console.log(chalk.blue('\nEnvCP Doctor\n'));
    for (const check of checks) {
      const icon = check.status === 'pass' ? chalk.green('PASS') : check.status === 'warn' ? chalk.yellow('WARN') : chalk.red('FAIL');
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
  });

program
  .command('vault')
  .description('Manage vault settings')
  .addCommand(
    new Command('rename')
      .description('Rename the current vault (updates project name in config)')
      .argument('<name>', 'New vault name')
      .action(async (name: string) => {
        const projectPath = process.cwd();
        try {
          const config = await loadConfig(projectPath);
          const old = config.project || path.basename(projectPath);
          config.project = name;
          await saveConfig(config, projectPath);
          console.log(`Vault renamed: ${old} -> ${name}`);
        } catch (error) {
          console.error(`Failed to rename vault: ${(error as Error).message}`);
          process.exit(1);
        }
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
        await withSession(async (storage, password, config, projectPath) => {
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
if (!await fs.pathExists(firstRunMarker)) {
  await fs.ensureDir(path.dirname(firstRunMarker));
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

program.parse();
