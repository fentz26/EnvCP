import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function findProjectRoot(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  while (true) {
    if (await pathExists(path.join(dir, 'envcp.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Handle basic escape sequences
    value = value.replaceAll('\\n', '\n')
                 .replaceAll('\\t', '\t')
                 .replaceAll('\\r', '\r')
                 .replaceAll('\\\\', '\\');

    result[key] = value;
  }

  return result;
}
