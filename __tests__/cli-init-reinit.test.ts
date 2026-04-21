import { jest } from '@jest/globals';
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

jest.setTimeout(90000);

function execCLI(args: string[], opts: { cwd: string; input?: string; env?: NodeJS.ProcessEnv } = { cwd: '' }): ExecResult {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, ...opts.env, NO_COLOR: '1' },
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

describe('envcp init — re-init guard (issue #202)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    try {
      await fs.access(cliPath);
    } catch {
      throw new Error(`${cliPath} not found. Run npm run build first.`);
    }
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-reinit-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('first init succeeds and writes envcp.yaml', async () => {
    const first = execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp'], { cwd: tmpDir });
    expect(first.status).toBe(0);
    await fs.access(path.join(tmpDir, 'envcp.yaml'));
  });

  it('second init keeps existing setup and points user to setup', async () => {
    const first = execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp'], { cwd: tmpDir });
    expect(first.status).toBe(0);

    const configBefore = await fs.readFile(path.join(tmpDir, 'envcp.yaml'), 'utf-8');

    const second = execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp'], { cwd: tmpDir });
    expect(second.status).toBe(0);
    expect(second.stdout + second.stderr).toMatch(/already set up/i);
    expect(second.stdout + second.stderr).toMatch(/envcp setup/i);

    const configAfter = await fs.readFile(path.join(tmpDir, 'envcp.yaml'), 'utf-8');
    expect(configAfter).toBe(configBefore);
  });

  it('setup opens project configuration after init', async () => {
    const first = execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp', '-p', 'original'], { cwd: tmpDir });
    expect(first.status).toBe(0);

    const setup = execCLI(['setup'], { cwd: tmpDir });
    expect(setup.status).toBe(0);
    expect(setup.stdout + setup.stderr).toMatch(/EnvCP config/i);
  });
});
