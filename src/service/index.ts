import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, spawnSync, SpawnSyncReturns } from 'node:child_process';
import { ensureDir, pathExists } from '../utils/fs.js';
import {
  ServiceConfig,
  getServiceConfigPath,
  getServiceHome,
  getServiceLogPath,
  getServiceErrorLogPath,
  loadServiceConfig,
  saveServiceConfig,
} from './config.js';
import {
  GeneratorContext,
  generateSystemdUnit,
  generateLaunchdPlist,
  generateWindowsWrapperScript,
} from './generators.js';
import { detectPlatform, getUnitInstallPath, Platform } from './platform.js';

export * from './config.js';
export * from './generators.js';
export * from './platform.js';

export interface InstallOptions {
  configPath?: string;
  execPath?: string;
  nodePath?: string;
  workingDirectory?: string;
  now?: boolean;
}

export interface ServiceResult {
  ok: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
}

async function buildContext(
  config: ServiceConfig,
  opts: InstallOptions,
): Promise<GeneratorContext> {
  const execPath = opts.execPath || resolveExecPath();
  const nodePath = opts.nodePath || process.execPath;
  const workingDirectory =
    opts.workingDirectory || config.working_directory || process.cwd();
  return {
    execPath,
    nodePath,
    workingDirectory,
    logFile: getServiceLogPath(),
    errorLogFile: getServiceErrorLogPath(),
    config,
  };
}

function renderServiceUnit(platform: Platform, ctx: GeneratorContext): string {
  if (platform === 'linux') {
    return generateSystemdUnit(ctx);
  }
  if (platform === 'macos') {
    return generateLaunchdPlist(ctx);
  }
  return generateWindowsWrapperScript(ctx);
}

function installLinuxService(unitPath: string, autostart: boolean, startNow?: boolean): ServiceResult {
  const reload = runCommand('systemctl', ['--user', 'daemon-reload']);
  if (!reload.ok) return reload;
  if (autostart) {
    const enable = runCommand('systemctl', ['--user', 'enable', 'envcp.service']);
    if (!enable.ok) return enable;
  }
  if (startNow) {
    return runCommand('systemctl', ['--user', 'start', 'envcp.service']);
  }
  return { ok: true, message: `Installed systemd unit at ${unitPath}` };
}

function installMacosService(unitPath: string, startNow?: boolean): ServiceResult {
  if (startNow) {
    return runCommand('launchctl', ['load', '-w', unitPath]);
  }
  return { ok: true, message: `Installed launchd plist at ${unitPath}` };
}

function installWindowsService(unitPath: string, autostart: boolean, startNow?: boolean): ServiceResult {
  if (startNow || autostart) {
    const taskCmd = ['/Create', '/TN', 'EnvCP', '/TR', `"${unitPath}"`, '/SC', 'ONLOGON', '/F'];
    const result = runCommand('schtasks', taskCmd);
    if (!result.ok) return result;
    if (startNow) {
      return runCommand('schtasks', ['/Run', '/TN', 'EnvCP']);
    }
  }
  return { ok: true, message: `Installed service wrapper at ${unitPath}` };
}

function resolveExecPath(): string {
  const scriptUrl = new URL(import.meta.url);
  const here = path.dirname(scriptUrl.pathname);
  return path.resolve(here, '..', 'cli.js');
}

export async function installService(
  opts: InstallOptions = {},
): Promise<ServiceResult> {
  const platform = detectPlatform();
  const config = await loadServiceConfig(opts.configPath);
  const ctx = await buildContext(config, opts);

  await ensureDir(getServiceHome());
  const unitPath = getUnitInstallPath(platform);
  await ensureDir(path.dirname(unitPath));

  const body = renderServiceUnit(platform, ctx);

  await fs.writeFile(unitPath, body, { mode: 0o600 });

  // Save config file if it doesn't already exist, so the service has something to read
  const cfgPath = opts.configPath || getServiceConfigPath();
  if (!(await pathExists(cfgPath))) {
    await saveServiceConfig(config, cfgPath);
  }

  if (platform === 'linux') {
    return installLinuxService(unitPath, config.autostart, opts.now);
  }
  if (platform === 'macos') {
    return installMacosService(unitPath, opts.now);
  }
  return installWindowsService(unitPath, config.autostart, opts.now);
}

export async function uninstallService(): Promise<ServiceResult> {
  const platform = detectPlatform();
  const unitPath = getUnitInstallPath(platform);

  if (platform === 'linux') {
    runCommand('systemctl', ['--user', 'stop', 'envcp.service']);
    runCommand('systemctl', ['--user', 'disable', 'envcp.service']);
    if (await pathExists(unitPath)) await fs.unlink(unitPath);
    runCommand('systemctl', ['--user', 'daemon-reload']);
    return { ok: true, message: 'Uninstalled systemd unit' };
  }

  if (platform === 'macos') {
    if (await pathExists(unitPath)) {
      runCommand('launchctl', ['unload', '-w', unitPath]);
      await fs.unlink(unitPath);
    }
    return { ok: true, message: 'Uninstalled launchd plist' };
  }

  runCommand('schtasks', ['/End', '/TN', 'EnvCP']);
  runCommand('schtasks', ['/Delete', '/TN', 'EnvCP', '/F']);
  if (await pathExists(unitPath)) await fs.unlink(unitPath);
  return { ok: true, message: 'Uninstalled scheduled task' };
}

export async function startService(): Promise<ServiceResult> {
  const platform = detectPlatform();
  if (platform === 'linux') {
    return runCommand('systemctl', ['--user', 'start', 'envcp.service']);
  }
  if (platform === 'macos') {
    const unitPath = getUnitInstallPath('macos');
    return runCommand('launchctl', ['load', '-w', unitPath]);
  }
  return runCommand('schtasks', ['/Run', '/TN', 'EnvCP']);
}

export async function stopService(): Promise<ServiceResult> {
  const platform = detectPlatform();
  if (platform === 'linux') {
    return runCommand('systemctl', ['--user', 'stop', 'envcp.service']);
  }
  if (platform === 'macos') {
    const unitPath = getUnitInstallPath('macos');
    return runCommand('launchctl', ['unload', '-w', unitPath]);
  }
  return runCommand('schtasks', ['/End', '/TN', 'EnvCP']);
}

export async function statusService(): Promise<ServiceResult> {
  const platform = detectPlatform();
  if (platform === 'linux') {
    return runCommand('systemctl', [
      '--user',
      'status',
      'envcp.service',
      '--no-pager',
    ]);
  }
  if (platform === 'macos') {
    return runCommand('launchctl', ['list', 'com.envcp']);
  }
  return runCommand('schtasks', ['/Query', '/TN', 'EnvCP', '/V', '/FO', 'LIST']);
}

export async function logsService(follow = false): Promise<ServiceResult> {
  const platform = detectPlatform();
  if (platform === 'linux') {
    const args = [
      '--user',
      '-u',
      'envcp.service',
      '--no-pager',
    ];
    if (follow) args.push('-f');
    return runCommand('journalctl', args, follow);
  }
  // macOS and Windows: tail the file-based log
  const logFile = getServiceLogPath();
  if (!(await pathExists(logFile))) {
    return {
      ok: false,
      message: `No log file at ${logFile}`,
    };
  }
  if (follow) {
    const p: Platform = platform;
    const cmd = p === 'windows' ? 'powershell' : 'tail';
    const args =
      p === 'windows'
        ? ['-Command', `Get-Content -Path '${logFile}' -Wait -Tail 100`]
        : ['-f', logFile];
    return runCommand(cmd, args, true);
  }
  const data = await fs.readFile(logFile, 'utf-8');
  return { ok: true, message: 'ok', stdout: data };
}

function runCommand(
  cmd: string,
  args: string[],
  stream = false,
): ServiceResult {
  if (stream) {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    return {
      ok: true,
      /* c8 ignore next -- spawn always provides pid in normal operation */
      message: `streaming ${cmd} ${args.join(' ')} (pid ${child.pid ?? 'n/a'})`,
    };
  }
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(cmd, args, { encoding: 'utf-8' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to execute ${cmd}: ${msg}` };
  }
  if (result.error) {
    return {
      ok: false,
      message: `Failed to execute ${cmd}: ${result.error.message}`,
    };
  }
  const ok = (result.status ?? 1) === 0;
  return {
    ok,
    message: ok
      ? `${cmd} ${args.join(' ')} succeeded`
      : `${cmd} ${args.join(' ')} exited ${result.status}`,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
