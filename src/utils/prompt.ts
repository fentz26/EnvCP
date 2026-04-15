/* istanbul ignore file - tested via integration tests in __tests__/utils/prompt.test.ts */
import * as readline from 'readline';

/** Prompt for masked input (passwords). Characters echo as '*'. */
export async function promptPassword(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on('close', () => {
      if (!resolved) {
        reject(new Error('EOF: stdin closed without input'));
      }
    });
    process.stdout.write(`${message} `);

    // Switch stdin to raw mode for character-by-character reading
    const input = process.stdin;
    let value = '';
    let resolved = false;

    const onData = (char: Buffer | string) => {
      for (const ch of char.toString()) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          // Enter or Ctrl-D
          process.stdout.write('\n');
          cleanup();
          resolved = true; resolve(value);
          return;
        } else if (ch === '\u0003') {
          // Ctrl-C
          process.stdout.write('\n');
          cleanup();
          process.exit(1);
          return;
        } else if (ch === '\u007f' || ch === '\b') {
          // Backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          // Printable character
          value += ch;
          process.stdout.write('*');
        }
      }
    };

    const cleanup = () => {
      if (typeof (input as NodeJS.ReadStream).setRawMode === 'function') {
        (input as NodeJS.ReadStream).setRawMode(false);
      }
      input.removeListener('data', onData);
      rl.close();
    };

    if (typeof (input as NodeJS.ReadStream).setRawMode === 'function') {
      (input as NodeJS.ReadStream).setRawMode(true);
      input.resume();
      input.on('data', onData);
    } else {
      // Non-TTY fallback (piped input, CI) — read a full line without masking
      rl.once('line', (line) => {
        resolved = true;
        rl.close();
        resolve(line);
      });
    }
  });
}

/** Prompt for plain text input. */
export async function promptInput(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(`${message} `, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on('close', () => {
      if (!answered) {
        reject(new Error('EOF: stdin closed without input'));
      }
    });
  });
}

/** Prompt for y/n confirmation. Returns true for 'y'/'yes', false otherwise. */
export async function promptConfirm(message: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await promptInput(`${message} ${hint}`);
  if (answer.trim() === '') return defaultValue;
  return /^y(es)?$/i.test(answer.trim());
}

export interface ListChoice {
  name: string;
  value: string;
}

/** Prompt to select from a list of choices (numbered menu). */
export async function promptList(message: string, choices: ListChoice[], defaultValue?: string): Promise<string> {
  if (choices.length === 0) {
    throw new Error('No choices provided');
  }
  process.stdout.write(`${message}\n`);
  choices.forEach((c, i) => {
    const isDefault = c.value === defaultValue;
    process.stdout.write(`  ${i + 1}) ${c.name}${isDefault ? ' (default)' : ''}\n`);
  });

  const defaultIndex = choices.findIndex(c => c.value === defaultValue);
  const hint = defaultIndex >= 0 ? ` [${defaultIndex + 1}]` : '';

  while (true) {
    const answer = await promptInput(`Enter choice${hint}:`);
    // Handle EOF (empty responses when stdin is exhausted)
    if (answer === '' && defaultIndex < 0 && !process.stdin.isTTY) {
      // No default and no input - could indicate EOF; avoid infinite loop
      throw new Error('No selection made and no default available');
    }
    if (answer.trim() === '' && defaultIndex >= 0) {
      return choices[defaultIndex].value;
    }
    const num = parseInt(answer.trim(), 10);
    if (num >= 1 && num <= choices.length) {
      return choices[num - 1].value;
    }
    process.stdout.write(`  Please enter a number between 1 and ${choices.length}\n`);
  }
}
