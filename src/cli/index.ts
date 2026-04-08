import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs-extra';
import { loadConfig, saveConfig, initConfig } from '../config/manager.js';
import { StorageManager, LogManager } from '../storage/index.js';
import { SessionManager } from '../utils/session.js';
import { maskValue, validatePassword } from '../utils/crypto.js';
import { Variable, EnvCPConfig } from '../types.js';

async function withSession(fn: (storage: StorageManager, password: string, config: EnvCPConfig, projectPath: string) => Promise<void>): Promise<void> {
  const projectPath = process.cwd();
  const config = await loadConfig(projectPath);

  const sessionManager = new SessionManager(
    path.join(projectPath, config.session?.path || '.envcp/.session'),
    config.session?.timeout_minutes || 30,
    config.session?.max_extensions || 5
  );
  await sessionManager.init();

  let session = await sessionManager.load();
  let password = '';

  if (!session) {
    const answer = await inquirer.prompt([
      { type: 'password', name: 'password', message: 'Enter password:', mask: '*' }
    ]);
    password = answer.password;

    const validation = validatePassword(password, config.password || {});
    if (!validation.valid) {
      console.log(chalk.red(validation.error));
      return;
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
  .option('-e, --encrypted', 'Enable encryption', true)
  .action(async (options) => {
    const projectPath = process.cwd();
    const projectName = options.project || path.basename(projectPath);
    
    console.log(chalk.blue('Initializing EnvCP...'));
    
    const config = await initConfig(projectPath, projectName);
    
    console.log(chalk.green('EnvCP initialized successfully!'));
    console.log(chalk.gray(`  Project: ${config.project}`));
    console.log(chalk.gray(`  Storage: ${config.storage.path}`));
    console.log(chalk.gray(`  Encrypted: ${config.storage.encrypted}`));
    console.log(chalk.gray(`  Session timeout: ${config.session?.timeout_minutes || 30} minutes`));
    console.log(chalk.gray(`  AI active check: ${config.access?.allow_ai_active_check ? 'enabled' : 'disabled'}`));
  });

program
  .command('unlock')
  .description('Unlock EnvCP session with password')
  .option('-p, --password <password>', 'Password (will prompt if not provided)')
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
    await withSession(async (storage) => {
      const variables = await storage.load();
      const names = Object.keys(variables);

      if (names.length === 0) {
        console.log(chalk.yellow('No variables found'));
        return;
      }

      console.log(chalk.blue(`\nVariables (${names.length}):\n`));

      for (const name of names) {
        const v = variables[name];
        const value = options.showValues ? v.value : maskValue(v.value);
        const tags = v.tags ? chalk.gray(` [${v.tags.join(', ')}]`) : '';
        console.log(`  ${chalk.cyan(name)} = ${value}${tags}`);
      }

      console.log('');
    });
  });

program
  .command('get <name>')
  .description('Get a variable value')
  .action(async (name) => {
    await withSession(async (storage) => {
      const variable = await storage.get(name);

      if (!variable) {
        console.log(chalk.red(`Variable '${name}' not found`));
        return;
      }

      console.log(chalk.cyan(name));
      console.log(`  Value: ${variable.value}`);
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
  .action(async () => {
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
        const needsQuoting = /[\s#"'\\]/.test(variable.value);
        const val = needsQuoting ? `"${variable.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : variable.value;
        lines.push(`${name}=${val}`);
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
    
    const sessionManager = new SessionManager(
      path.join(projectPath, config.session?.path || '.envcp/.session'),
      config.session?.timeout_minutes || 30,
      config.session?.max_extensions || 5
    );
    await sessionManager.init();
    
    let session = await sessionManager.load();
    let password = options.password;
    
    if (!session && !password) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter password:', mask: '*' }
      ]);
      password = answer.password;
      
      const validation = validatePassword(password, config.password || {});
      if (!validation.valid) {
        console.log(chalk.red(validation.error));
        return;
      }
      
      session = await sessionManager.create(password);
    }
    
    password = sessionManager.getPassword() || password;

    const mode = options.mode as string;
    const port = parseInt(options.port, 10);
    const host = options.host;
    const apiKey = options.apiKey;

    // MCP mode uses stdio
    if (mode === 'mcp') {
      const { EnvCPServer } = await import('../mcp/server.js');
      const server = new EnvCPServer(config, projectPath, password);
      await server.start();
      return;
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
    if (apiKey) console.log(chalk.gray(`  API Key: ${apiKey.substring(0, 4)}...`));
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
  .action(async (options) => {
    await withSession(async (storage) => {
    const variables = await storage.load();
    
    let output: string;
    
    switch (options.format) {
      case 'json':
        output = JSON.stringify(variables, null, 2);
        break;
      case 'yaml':
        const yaml = await import('js-yaml');
        output = yaml.dump(variables);
        break;
      default:
        const lines = Object.entries(variables).map(([k, v]) => {
          const needsQuoting = /[\s#"'\\]/.test(v.value);
          const val = needsQuoting ? `"${v.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v.value;
          return `${k}=${val}`;
        });
        output = lines.join('\n');
    }

    console.log(output);
    });
  });

program.parse();
