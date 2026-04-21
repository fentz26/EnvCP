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

export interface ParseEnvOptions {
  /** When true, lines whose key fails the POSIX identifier regex are dropped. */
  validateNames?: boolean;
  /**
   * Escape handling:
   * - 'standard' (default): unconditionally unescape `\n`, `\t`, `\r`, `\\` (dev-convenience).
   * - 'dotenv': only unescape `\"` and `\\` inside double-quoted values (strict .env semantics).
   */
  escapeStyle?: 'standard' | 'dotenv';
}

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnv(content: string, opts: ParseEnvOptions = {}): Record<string, string> {
  const { validateNames = false, escapeStyle = 'standard' } = opts;
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (validateNames && !ENV_NAME_RE.test(key)) continue;

    const isDoubleQuoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    const isSingleQuoted = value.length >= 2 && value.startsWith("'") && value.endsWith("'");

    if (isDoubleQuoted || isSingleQuoted) {
      value = value.slice(1, -1);
    }

    if (escapeStyle === 'dotenv') {
      if (isDoubleQuoted) {
        value = value.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
      }
    } else {
      value = value.replaceAll('\\n', '\n')
                   .replaceAll('\\t', '\t')
                   .replaceAll('\\r', '\r')
                   .replaceAll('\\\\', '\\');
    }

    result[key] = value;
  }

  return result;
}
