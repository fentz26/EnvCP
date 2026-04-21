import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const cliPath = path.join(projectRoot, 'dist', 'cli', 'index.js');

function execCLI(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('envcp vault CLI', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await fs.access(cliPath);
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-vault-cli-'));
    const init = execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp'], tmpDir);
    expect(init.status).toBe(0);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('lists vault contexts from the vault command', () => {
    const result = execCLI(['vault', 'contexts'], tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Available vaults:');
    expect(result.stdout).toContain('project');
    expect(result.stdout).toContain('global');
  });

  it('switches to a built-in vault context with vault use', () => {
    const useResult = execCLI(['vault', 'use', 'global'], tmpDir);
    expect(useResult.status).toBe(0);
    expect(useResult.stdout).toContain('Switched to vault: global');

    const contexts = execCLI(['vault', 'contexts'], tmpDir);
    expect(contexts.stdout).toContain('global (active)');
  });

  it('switches to a named vault context with vault use', () => {
    const initNamed = execCLI(['vault', '--name', 'work', 'init'], tmpDir);
    expect(initNamed.status).toBe(0);

    const useResult = execCLI(['vault', 'use', 'work'], tmpDir);
    expect(useResult.status).toBe(0);
    expect(useResult.stdout).toContain('Switched to vault: work');

    const contexts = execCLI(['vault', 'contexts'], tmpDir);
    expect(contexts.stdout).toContain('work (active)');
  });
});
