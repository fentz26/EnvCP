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

function execCLI(args: string[], opts: { cwd: string; input?: string; env?: NodeJS.ProcessEnv } = { cwd: '' }): ExecResult {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: opts.cwd,
    input: opts.input,
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

describe('envcp add — secure input methods (issue #201)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    try {
      await fs.access(cliPath);
    } catch {
      throw new Error(`${cliPath} not found. Run npm run build first.`);
    }
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-add-input-'));
    const init = execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp'], { cwd: tmpDir });
    if (init.status !== 0) {
      throw new Error(`init failed: ${init.stderr}`);
    }
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('--from-env', () => {
    it('reads the value from the named environment variable', () => {
      const add = execCLI(['add', 'MY_KEY', '--from-env', 'SRC_SECRET'], {
        cwd: tmpDir,
        env: { SRC_SECRET: 'from-env-value' },
      });
      expect(add.status).toBe(0);

      const get = execCLI(['get', 'MY_KEY', '--show-value'], { cwd: tmpDir });
      expect(get.stdout).toContain('from-env-value');
    });

    it('errors when the env var is not set', () => {
      const envWithout = { ...process.env };
      delete envWithout.UNSET_SECRET;
      const add = execCLI(['add', 'MY_KEY', '--from-env', 'UNSET_SECRET'], {
        cwd: tmpDir,
        env: envWithout,
      });
      expect(add.status).not.toBe(0);
      expect(add.stderr + add.stdout).toMatch(/UNSET_SECRET.*not set/);
    });
  });

  describe('--from-file', () => {
    it('reads the value from a file and trims trailing newline', async () => {
      const secretPath = path.join(tmpDir, 'secret.txt');
      await fs.writeFile(secretPath, 'file-secret\n');

      const add = execCLI(['add', 'FILE_KEY', '--from-file', secretPath], { cwd: tmpDir });
      expect(add.status).toBe(0);

      const get = execCLI(['get', 'FILE_KEY', '--show-value'], { cwd: tmpDir });
      expect(get.stdout).toContain('file-secret');
      expect(get.stdout).not.toContain('file-secret\n\n');
    });

    it('errors when the file does not exist', () => {
      const missing = path.join(tmpDir, 'does-not-exist');
      const add = execCLI(['add', 'FILE_KEY', '--from-file', missing], { cwd: tmpDir });
      expect(add.status).not.toBe(0);
      expect(add.stderr + add.stdout).toMatch(/cannot read/i);
    });
  });

  describe('--stdin', () => {
    it('reads piped stdin and trims trailing newline', () => {
      const add = execCLI(['add', 'STDIN_KEY', '--stdin'], {
        cwd: tmpDir,
        input: 'piped-secret\n',
      });
      expect(add.status).toBe(0);

      const get = execCLI(['get', 'STDIN_KEY', '--show-value'], { cwd: tmpDir });
      expect(get.stdout).toContain('piped-secret');
    });
  });

  describe('mutual exclusivity', () => {
    it('rejects --value combined with --from-env', () => {
      const add = execCLI(['add', 'X', '--value', 'v', '--from-env', 'SRC'], {
        cwd: tmpDir,
        env: { SRC: 'abc' },
      });
      expect(add.status).not.toBe(0);
      expect(add.stderr + add.stdout).toMatch(/mutually exclusive/);
    });

    it('rejects --from-file combined with --stdin', async () => {
      const secretPath = path.join(tmpDir, 'secret.txt');
      await fs.writeFile(secretPath, 'x');
      const add = execCLI(['add', 'X', '--from-file', secretPath, '--stdin'], {
        cwd: tmpDir,
        input: 'y',
      });
      expect(add.status).not.toBe(0);
      expect(add.stderr + add.stdout).toMatch(/mutually exclusive/);
    });
  });
});
