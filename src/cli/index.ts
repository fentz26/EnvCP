import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs-extra';
import { loadConfig, saveConfig, initConfig } from '../config/manager.js';
import { StorageManager, LogManager } from '../storage/index.js';
import { maskValue } from '../utils/crypto.js';
import { Variable } from '../types.js';

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
    
    console.log(chalk.green('✓ EnvCP initialized successfully!'));
    console.log(chalk.gray(`  Project: ${config.project}`));
    console.log(chalk.gray(`  Storage: ${config.storage.path}`));
    console.log(chalk.gray(`  Encrypted: ${config.storage.encrypted}`));
  });

program
  .command('add <name>')
  .description('Add a new environment variable')
  .option('-v, --value <value>', 'Variable value')
  .option('-e, --encrypt', 'Encrypt the value', true)
  .option('-t, --tags <tags>', 'Tags (comma-separated)')
  .option('-d, --description <desc>', 'Description')
  .action(async (name, options) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
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

    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );

    let password: string | undefined;
    if (config.storage.encrypted) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter encryption password:', mask: '*' }
      ]);
      password = answer.password;
      storage.setPassword(password);
    }

    const now = new Date().toISOString();
    const variable: Variable = {
      name,
      value,
      encrypted: options.encrypt,
      tags: tags.length > 0 ? tags : undefined,
      description,
      created: now,
      updated: now,
      sync_to_env: true,
    };

    await storage.set(name, variable);

    console.log(chalk.green(`✓ Variable '${name}' added successfully`));
  });

program
  .command('list')
  .description('List all variables (names only, values hidden)')
  .option('-v, --show-values', 'Show actual values (requires password)')
  .action(async (options) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );

    if (options.showValues && config.storage.encrypted) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter encryption password:', mask: '*' }
      ]);
      storage.setPassword(answer.password);
    }

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

program
  .command('get <name>')
  .description('Get a variable value')
  .action(async (name) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );

    if (config.storage.encrypted) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter encryption password:', mask: '*' }
      ]);
      storage.setPassword(answer.password);
    }

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

program
  .command('remove <name>')
  .description('Remove a variable')
  .action(async (name) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );

    if (config.storage.encrypted) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter encryption password:', mask: '*' }
      ]);
      storage.setPassword(answer.password);
    }

    const deleted = await storage.delete(name);
    
    if (deleted) {
      console.log(chalk.green(`✓ Variable '${name}' removed`));
    } else {
      console.log(chalk.red(`Variable '${name}' not found`));
    }
  });

program
  .command('sync')
  .description('Sync variables to .env file')
  .action(async () => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    if (!config.sync.enabled) {
      console.log(chalk.yellow('Sync is disabled in configuration'));
      return;
    }

    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );

    if (config.storage.encrypted) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter encryption password:', mask: '*' }
      ]);
      storage.setPassword(answer.password);
    }

    const variables = await storage.load();
    const lines: string[] = [];

    if (config.sync.header) {
      lines.push(config.sync.header);
    }

    for (const [name, variable] of Object.entries(variables)) {
      lines.push(`${name}=${variable.value}`);
    }

    await fs.writeFile(path.join(projectPath, config.sync.target), lines.join('\n'), 'utf8');
    console.log(chalk.green(`✓ Synced ${lines.length} variables to ${config.sync.target}`));
  });

program
  .command('serve')
  .description('Start MCP server')
  .option('-p, --password <password>', 'Encryption password')
  .action(async (options) => {
    const { EnvCPServer } = await import('../mcp/server.js');
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    let password = options.password;
    
    if (!password && config.storage.encrypted) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter encryption password:', mask: '*' }
      ]);
      password = answer.password;
    }

    const server = new EnvCPServer(config, projectPath, password);
    await server.start();
  });

program
  .command('export')
  .description('Export variables')
  .option('-f, --format <format>', 'Output format: env, json, yaml', 'env')
  .action(async (options) => {
    const projectPath = process.cwd();
    const config = await loadConfig(projectPath);
    
    const storage = new StorageManager(
      path.join(projectPath, config.storage.path),
      config.storage.encrypted
    );

    if (config.storage.encrypted) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'password', message: 'Enter encryption password:', mask: '*' }
      ]);
      storage.setPassword(answer.password);
    }

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
        const lines = Object.entries(variables).map(([k, v]) => `${k}=${v.value}`);
        output = lines.join('\n');
    }

    console.log(output);
  });

program.parse();
