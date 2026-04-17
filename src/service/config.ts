import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { pathExists, ensureDir } from '../utils/fs.js';

export interface ServiceConfig {
  server: {
    mode: string;
    port: number;
    host: string;
    api_key?: string;
  };
  autostart: boolean;
  restart_on_failure: boolean;
  log_level: string;
  working_directory?: string;
}

export const DEFAULT_SERVICE_CONFIG: ServiceConfig = {
  server: {
    mode: 'auto',
    port: 3456,
    host: '127.0.0.1',
  },
  autostart: true,
  restart_on_failure: true,
  log_level: 'info',
};

export function getServiceHome(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, '.envcp');
}

export function getServiceConfigPath(): string {
  return path.join(getServiceHome(), 'service.yaml');
}

export function getServiceLogPath(): string {
  return path.join(getServiceHome(), 'service.log');
}

export function getServiceErrorLogPath(): string {
  return path.join(getServiceHome(), 'service.err.log');
}

export async function loadServiceConfig(configPath?: string): Promise<ServiceConfig> {
  const p = configPath || getServiceConfigPath();
  if (!(await pathExists(p))) {
    return { ...DEFAULT_SERVICE_CONFIG };
  }
  const raw = await fs.readFile(p, 'utf-8');
  let parsed: Partial<ServiceConfig> = {};
  if (p.endsWith('.json')) {
    parsed = JSON.parse(raw);
  } else {
    parsed = (yaml.load(raw) as Partial<ServiceConfig>) || {};
  }
  return mergeServiceConfig(parsed);
}

export function mergeServiceConfig(partial: Partial<ServiceConfig>): ServiceConfig {
  return {
    server: {
      ...DEFAULT_SERVICE_CONFIG.server,
      ...(partial.server || {}),
    },
    autostart: partial.autostart ?? DEFAULT_SERVICE_CONFIG.autostart,
    restart_on_failure:
      partial.restart_on_failure ?? DEFAULT_SERVICE_CONFIG.restart_on_failure,
    log_level: partial.log_level ?? DEFAULT_SERVICE_CONFIG.log_level,
    working_directory: partial.working_directory,
  };
}

export async function saveServiceConfig(
  config: ServiceConfig,
  configPath?: string,
): Promise<string> {
  const p = configPath || getServiceConfigPath();
  await ensureDir(path.dirname(p));
  const body = p.endsWith('.json')
    ? JSON.stringify(config, null, 2)
    : yaml.dump(config);
  await fs.writeFile(p, body, { mode: 0o600 });
  try {
    await fs.chmod(p, 0o600);
  } catch {
    // ignore on platforms without chmod
  }
  return p;
}
