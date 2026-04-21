import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
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

// SECURITY: Service unit/script generators interpolate these values into
// systemd ExecStart, launchd plist, and Windows .bat. Reject characters that
// could break out of those formats (newlines, quotes, shell metas).
const SAFE_API_KEY = /^[A-Za-z0-9_-]+$/;
const UNSAFE_PATH_CHARS = /[\r\n"`$|&;<>]/;

function assertSafe(field: string, value: string | undefined, pattern?: RegExp): void {
  if (value === undefined) return;
  if (pattern) {
    if (!pattern.test(value)) {
      throw new Error(`Invalid ${field}: contains disallowed characters`);
    }
  } else if (UNSAFE_PATH_CHARS.test(value)) {
    throw new Error(`Invalid ${field}: contains disallowed characters`);
  }
}

export function mergeServiceConfig(partial: Partial<ServiceConfig>): ServiceConfig {
  const merged: ServiceConfig = {
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

  assertSafe('server.api_key', merged.server.api_key, SAFE_API_KEY);
  assertSafe('server.host', merged.server.host);
  assertSafe('server.mode', merged.server.mode);
  assertSafe('log_level', merged.log_level);
  assertSafe('working_directory', merged.working_directory);

  return merged;
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
  /* c8 ignore next -- chmod not available on all platforms */
  } catch {
    // ignore on platforms without chmod
  }
  return p;
}
