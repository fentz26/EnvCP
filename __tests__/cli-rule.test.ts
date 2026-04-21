import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const cliPath = path.join(projectRoot, 'dist', 'cli', 'index.js');

function execCLI(args: string[], cwd: string, input = ''): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd,
    input,
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

describe('envcp rule CLI', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await fs.access(cliPath);
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-rule-cli-'));
    const init = execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp'], tmpDir);
    expect(init.status).toBe(0);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sets and lists default rules', () => {
    const setResult = execCLI(['rule', 'set-default', 'read', 'allow'], tmpDir);
    expect(setResult.status).toBe(0);
    expect(setResult.stdout).toContain('Default read rule set to allow in project scope');

    const listResult = execCLI(['rule', 'list'], tmpDir);
    expect(listResult.status).toBe(0);
    expect(listResult.stdout).toContain('Default read: allow');
  });

  it('sets and removes variable-specific rules', () => {
    const setResult = execCLI(['rule', 'set-variable', 'OPENAI_API_KEY', 'run', 'deny'], tmpDir);
    expect(setResult.status).toBe(0);
    expect(setResult.stdout).toContain('Variable rule for OPENAI_API_KEY run set to deny in project scope');

    const listResult = execCLI(['rule', 'list'], tmpDir);
    expect(listResult.stdout).toContain('OPENAI_API_KEY [project]');
    expect(listResult.stdout).toContain('run: deny');

    const removeResult = execCLI(['rule', 'remove-variable', 'OPENAI_API_KEY'], tmpDir);
    expect(removeResult.status).toBe(0);

    const finalList = execCLI(['rule', 'list'], tmpDir);
    expect(finalList.stdout).not.toContain('OPENAI_API_KEY');
  });

  it('sets and clears a variable rule time window', () => {
    const setWindow = execCLI(['rule', 'set-window', 'OPENAI_API_KEY', '09:00', '18:00'], tmpDir);
    expect(setWindow.status).toBe(0);
    expect(setWindow.stdout).toContain('Variable rule window for OPENAI_API_KEY set to 09:00-18:00 in project scope');

    const listResult = execCLI(['rule', 'list'], tmpDir);
    expect(listResult.stdout).toContain('OPENAI_API_KEY [project]');
    expect(listResult.stdout).toContain('active: 09:00-18:00');

    const clearWindow = execCLI(['rule', 'clear-window', 'OPENAI_API_KEY'], tmpDir);
    expect(clearWindow.status).toBe(0);

    const finalList = execCLI(['rule', 'list'], tmpDir);
    expect(finalList.stdout).not.toContain('active: 09:00-18:00');
  });

  it('supports home scope separately from project scope', () => {
    const setHome = execCLI(['rule', 'set-variable', 'GLOBAL_KEY', 'read', 'allow', '--scope', 'home'], tmpDir);
    expect(setHome.status).toBe(0);
    expect(setHome.stdout).toContain('in home scope');

    const projectList = execCLI(['rule', 'list', '--scope', 'project'], tmpDir);
    expect(projectList.stdout).not.toContain('GLOBAL_KEY');

    const mergedList = execCLI(['rule', 'list', '--scope', 'merged'], tmpDir);
    expect(mergedList.stdout).toContain('GLOBAL_KEY [home]');
  });

  it('supports who-specific rules and lists them clearly', () => {
    const setDefault = execCLI(['rule', 'set-default', 'list', 'allow', '--who', 'openai'], tmpDir);
    expect(setDefault.status).toBe(0);
    expect(setDefault.stdout).toContain('Default list rule set to allow for openai in project scope');

    const setVariable = execCLI(['rule', 'set-variable', 'OPENAI_API_KEY', 'read', 'allow', '--who', 'openai'], tmpDir);
    expect(setVariable.status).toBe(0);
    expect(setVariable.stdout).toContain('Variable rule for OPENAI_API_KEY read set to allow for openai in project scope');

    const listResult = execCLI(['rule', 'list'], tmpDir);
    expect(listResult.stdout).toContain('Who rules:');
    expect(listResult.stdout).toContain('OpenAI-compatible (openai) [project]');
    expect(listResult.stdout).toContain('list names: allow');
    expect(listResult.stdout).toContain('variable rules:');
    expect(listResult.stdout).toContain('OPENAI_API_KEY');
    expect(listResult.stdout).toContain('read: allow');
    expect(listResult.stdout).toContain('use `envcp rule set-default ... --who <id>`');
  });
});
