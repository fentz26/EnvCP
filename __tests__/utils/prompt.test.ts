import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');
const distDir = path.join(projectRoot, 'dist');
const promptPath = path.join(distDir, 'utils', 'prompt.js');

describe('prompt utilities', () => {
  let tmpDir: string;

  beforeAll(async () => {
    try {
      await fs.access(distDir);
    } catch {
      throw new Error('dist/ not found. Run npm run build first.');
    }
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-prompt-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('promptPassword', () => {
    it('returns password in non-TTY mode', async () => {
      const script = `import { promptPassword } from '${promptPath}'; const pwd = await promptPassword('Password:'); process.stdout.write('RESULT:' + pwd);`;
      const result = await runPromptWithInput(script, 'mysecret\n');
      expect(result).toContain('RESULT:mysecret');
    });

    it('rejects on EOF without input', async () => {
      const script = `import { promptPassword } from '${promptPath}'; try { await promptPassword('Password:'); process.stdout.write('RESULT:success'); } catch (e) { process.stdout.write('ERROR:' + e.message); }`;
      const result = await runPromptWithInput(script, '');
      expect(result).toContain('ERROR:EOF');
    });
  });

  describe('promptInput', () => {
    it('returns user input', async () => {
      const script = `import { promptInput } from '${promptPath}'; const input = await promptInput('Enter:'); process.stdout.write('RESULT:' + input);`;
      const result = await runPromptWithInput(script, 'hello\n');
      expect(result).toContain('RESULT:hello');
    });

    it('returns empty string for empty line', async () => {
      const script = `import { promptInput } from '${promptPath}'; const input = await promptInput('Enter:'); process.stdout.write('RESULT:|' + input + '|');`;
      const result = await runPromptWithInput(script, '\n');
      expect(result).toContain('RESULT:||');
    });

    it('rejects on EOF without answer', async () => {
      const script = `import { promptInput } from '${promptPath}'; try { await promptInput('Enter:'); process.stdout.write('RESULT:success'); } catch (e) { process.stdout.write('ERROR:' + e.message); }`;
      const result = await runPromptWithInput(script, '');
      expect(result).toContain('ERROR:EOF');
    });
  });

  describe('promptConfirm', () => {
    it('returns true for y', async () => {
      const script = `import { promptConfirm } from '${promptPath}'; const c = await promptConfirm('Continue?', false); process.stdout.write('RESULT:' + c);`;
      const result = await runPromptWithInput(script, 'y\n');
      expect(result).toContain('RESULT:true');
    });

    it('returns true for YES', async () => {
      const script = `import { promptConfirm } from '${promptPath}'; const c = await promptConfirm('Continue?', false); process.stdout.write('RESULT:' + c);`;
      const result = await runPromptWithInput(script, 'YES\n');
      expect(result).toContain('RESULT:true');
    });

    it('returns false for n', async () => {
      const script = `import { promptConfirm } from '${promptPath}'; const c = await promptConfirm('Continue?', true); process.stdout.write('RESULT:' + c);`;
      const result = await runPromptWithInput(script, 'n\n');
      expect(result).toContain('RESULT:false');
    });

    it('returns false for other input', async () => {
      const script = `import { promptConfirm } from '${promptPath}'; const c = await promptConfirm('Continue?', true); process.stdout.write('RESULT:' + c);`;
      const result = await runPromptWithInput(script, 'nope\n');
      expect(result).toContain('RESULT:false');
    });

    it('returns default true for empty', async () => {
      const script = `import { promptConfirm } from '${promptPath}'; const c = await promptConfirm('Continue?', true); process.stdout.write('RESULT:' + c);`;
      const result = await runPromptWithInput(script, '\n');
      expect(result).toContain('RESULT:true');
    });

    it('returns default false for empty', async () => {
      const script = `import { promptConfirm } from '${promptPath}'; const c = await promptConfirm('Continue?', false); process.stdout.write('RESULT:' + c);`;
      const result = await runPromptWithInput(script, '\n');
      expect(result).toContain('RESULT:false');
    });
  });

  describe('promptList', () => {
    it('returns selected choice', async () => {
      const script = `import { promptList } from '${promptPath}'; const c = [{name:'A',value:'a'},{name:'B',value:'b'},{name:'C',value:'c'}]; const s = await promptList('Choose:',c); process.stdout.write('RESULT:' + s);`;
      const result = await runPromptWithInput(script, '2\n');
      expect(result).toContain('RESULT:b');
    });

    it('returns default for empty', async () => {
      const script = `import { promptList } from '${promptPath}'; const c = [{name:'A',value:'a'},{name:'B',value:'b'}]; const s = await promptList('Choose:',c,'b'); process.stdout.write('RESULT:' + s);`;
      const result = await runPromptWithInput(script, '\n');
      expect(result).toContain('RESULT:b');
    });

    it('throws when no choices', async () => {
      const script = `import { promptList } from '${promptPath}'; try { await promptList('Choose:',[]); process.stdout.write('RESULT:success'); } catch (e) { process.stdout.write('ERROR:' + e.message); }`;
      const result = await runPromptWithInput(script, '');
      expect(result).toContain('ERROR:No choices provided');
    });

it('shows error on invalid input', async () => {
      const script = `import { promptList } from '${promptPath}'; const c = [{name:'A',value:'a'},{name:'B',value:'b'}]; setTimeout(() => { process.stdout.write('TIMEOUT'); process.exit(0); }, 1000); const s = await promptList('Choose:',c); process.stdout.write('RESULT:' + s);`;
      const result = await runPromptWithInput(script, '99\n');
      // Should show error message before timeout
      expect(result).toContain('Please enter a number');
    });

    it('throws on EOF without default', async () => {
      const script = `import { promptList } from '${promptPath}'; const c = [{name:'A',value:'a'}]; try { await promptList('Choose:',c); process.stdout.write('RESULT:success'); } catch (e) { process.stdout.write('ERROR:' + e.message); }`;
      const result = await runPromptWithInput(script, '\n');
      expect(result).toContain('ERROR:No selection made');
    });

    it('shows default marker', async () => {
      const script = `import { promptList } from '${promptPath}'; const c = [{name:'A',value:'a'},{name:'B',value:'b'}]; await promptList('Choose:',c,'a'); process.stdout.write('DONE');`;
      const result = await runPromptWithInput(script, '1\n');
      expect(result).toContain('(default)');
    });
  });

  async function runPromptWithInput(code: string, input: string): Promise<string> {
    const scriptPath = path.join(tmpDir, 'test.mjs');
    const inputPath = path.join(tmpDir, 'input.txt');
    await fs.writeFile(scriptPath, code);
    await fs.writeFile(inputPath, input);
    try {
      // Use bash -c with sleep to keep stdin open
      return execSync(`bash -c 'cat "${inputPath}" | node "${scriptPath}"'`, { cwd: projectRoot, encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 });
    } catch (e) {
      return (e as { stdout?: string }).stdout || '';
    }
  }
});
