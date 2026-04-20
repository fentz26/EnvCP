import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const cliPath = path.join(projectRoot, 'dist', 'cli', 'index.js');

interface ExecResult { stdout: string; stderr: string; status: number | null; }

function execCLI(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv } = { cwd: '' }): ExecResult {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: opts.cwd,
    encoding: 'utf-8',
    timeout: 20000,
    env: { ...process.env, ...opts.env, NO_COLOR: '1' },
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

async function setLogPath(cwd: string, logPath: string): Promise<void> {
  const configPath = path.join(cwd, 'envcp.yaml');
  const existing = await fs.readFile(configPath, 'utf-8');
  const injected = existing.replace(/^audit:\s*\n/m, `audit:\n  log_path: '${logPath}'\n`);
  await fs.writeFile(
    configPath,
    injected === existing ? existing + `\naudit:\n  log_path: '${logPath}'\n` : injected,
  );
  // Invalidate the config signature so loadConfig regenerates it.
  await fs.rm(path.join(cwd, '.envcp', '.config_signature'), { force: true });
}

async function writeLogEntry(logDir: string, date: string): Promise<void> {
  await fs.mkdir(logDir, { recursive: true });
  const entry = JSON.stringify({
    timestamp: `${date}T12:00:00.000Z`,
    operation: 'unlock',
    source: 'cli',
    success: true,
    message: 'seeded by test',
    session_id: '',
    client_id: 'cli',
    client_type: 'terminal',
    ip: '127.0.0.1',
  });
  await fs.writeFile(path.join(logDir, `operations-${date}.log`), entry + '\n');
}

describe('envcp logs — reads from configured log_path (issue #204)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    try {
      await fs.access(cliPath);
    } catch {
      throw new Error(`${cliPath} not found. Run npm run build first.`);
    }
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logpath-'));
    expect(execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp'], { cwd: tmpDir }).status).toBe(0);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads from default .envcp/logs when log_path is unset', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await writeLogEntry(path.join(tmpDir, '.envcp', 'logs'), today);

    const out = execCLI(['logs', '--date', today], { cwd: tmpDir });
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/seeded by test/);
  });

  it('reads from an absolute log_path', async () => {
    const customDir = path.join(tmpDir, 'custom-logs');
    await setLogPath(tmpDir, customDir);
    const today = new Date().toISOString().slice(0, 10);
    await writeLogEntry(customDir, today);

    const out = execCLI(['logs', '--date', today], { cwd: tmpDir });
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/seeded by test/);
  });

  it('reads from a project:REL log_path', async () => {
    await setLogPath(tmpDir, 'project:audit-trail');
    const today = new Date().toISOString().slice(0, 10);
    await writeLogEntry(path.join(tmpDir, 'audit-trail'), today);

    const out = execCLI(['logs', '--date', today], { cwd: tmpDir });
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/seeded by test/);
  });
});
