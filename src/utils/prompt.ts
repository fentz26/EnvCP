/* c8 ignore file - tested via integration tests in __tests__/utils/prompt.test.ts */
import * as readline from 'node:readline';

let nonTtyLinesPromise: Promise<string[]> | null = null;
let nonTtyLineIndex = 0;

async function consumeNonTtyLine(): Promise<string | null> {
  nonTtyLinesPromise ??= (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    if (content === '') {
      return [];
    }
    const lines = content.split(/\r?\n/);
    if (content.endsWith('\n')) {
      lines.pop();
    }
    return lines;
  })();

  const lines = await nonTtyLinesPromise;
  if (nonTtyLineIndex >= lines.length) {
    return null;
  }

  const line = lines[nonTtyLineIndex];
  nonTtyLineIndex += 1;
  return line;
}

/** Prompt for masked input (passwords). Characters echo as '*'. */
export async function promptPassword(message: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stdout.write(`${message} `);
    const line = await consumeNonTtyLine();
    if (line === null) {
      throw new Error('EOF: stdin closed without input');
    }
    return line;
  }

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

    if (input.isTTY && typeof (input as NodeJS.ReadStream).setRawMode === 'function') {
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
  if (!process.stdin.isTTY) {
    process.stdout.write(`${message} `);
    const line = await consumeNonTtyLine();
    if (line === null) {
      throw new Error('EOF: stdin closed without input');
    }
    return line;
  }

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

export interface MenuChoice {
  label: string;
  value: string;
  hint?: string;
}

export interface MenuTab {
  label: string;
  items: MenuChoice[];
}

function clearScreen(output: NodeJS.WriteStream): void {
  output.write('\x1Bc');
}

function formatMenuLine(choice: MenuChoice, isSelected: boolean): string {
  const prefix = isSelected ? chalkPointer() + ' ' : '  ';
  const hint = choice.hint ? ` ${choice.hint}` : '';
  return `${prefix}${choice.label}${hint}`;
}

function renderMenuItems(output: NodeJS.WriteStream, choices: MenuChoice[], selectedIndex: number): void {
  for (let i = 0; i < choices.length; i += 1) {
    output.write(`${formatMenuLine(choices[i], i === selectedIndex)}\n`);
  }
}

function createRawMenuSession<T>(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  resolve: (value: T) => void,
  reject: (error: Error) => void,
): {
  bind: (onData: (chunk: Buffer | string) => void) => void;
  finish: (value: T) => void;
  cancel: () => never;
} {
  let settled = false;

  const cleanup = () => {
    input.removeListener('data', onData);
    input.removeListener('error', onError);
    input.pause();
    input.setRawMode(false);
  };

  const finish = (value: T) => {
    settled = true;
    cleanup();
    clearScreen(output);
    resolve(value);
  };

  const cancel = (): never => {
    settled = true;
    cleanup();
    output.write('\n');
    process.exit(1);
  };

  const onError = (err: Error) => {
    if (!settled) {
      cleanup();
      reject(err);
    }
  };

  let onData = (_chunk: Buffer | string) => {};

  return {
    bind: (handler) => {
      onData = handler;
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
      input.once('error', onError);
    },
    finish,
    cancel,
  };
}

async function readListAnswer(hint: string, defaultIndex: number): Promise<string> {
  try {
    return await promptInput(`Enter choice${hint}:`);
  } catch (error) {
    if (!process.stdin.isTTY && defaultIndex < 0 && error instanceof Error && error.message.includes('EOF')) {
      throw new Error('No selection made and no default available');
    }
    throw error;
  }
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
    const answer = await readListAnswer(hint, defaultIndex);
    // Handle EOF (empty responses when stdin is exhausted)
    if (answer === '' && defaultIndex < 0 && !process.stdin.isTTY) {
      throw new Error('No selection made and no default available');
    }
    if (answer.trim() === '' && defaultIndex >= 0) {
      return choices[defaultIndex].value;
    }
    const num = Number.parseInt(answer.trim(), 10);
    if (num >= 1 && num <= choices.length) {
      return choices[num - 1].value;
    }
    process.stdout.write(`  Please enter a number between 1 and ${choices.length}\n`);
  }
}

export async function promptMenu(message: string, choices: MenuChoice[], initialValue?: string): Promise<string> {
  if (choices.length === 0) {
    throw new Error('No choices provided');
  }

  if (!process.stdin.isTTY || typeof (process.stdin as NodeJS.ReadStream).setRawMode !== 'function') {
    return promptList(
      message,
      choices.map((choice) => ({ name: choice.label, value: choice.value })),
      initialValue,
    );
  }

  const input = process.stdin as NodeJS.ReadStream;
  const output = process.stdout;
  let selectedIndex = Math.max(0, choices.findIndex((choice) => choice.value === initialValue));

  return new Promise((resolve, reject) => {
    const render = () => {
      clearScreen(output);
      output.write(`${message}\n\n`);
      renderMenuItems(output, choices, selectedIndex);
      output.write('\nUse arrow keys and press Enter.\n');
    };

    const session = createRawMenuSession(input, output, resolve, reject);

    const onData = (chunk: Buffer | string) => {
      const data = chunk.toString();
      if (data === '\u0003') {
        session.cancel();
      }

      if (data === '\r' || data === '\n') {
        session.finish(choices[selectedIndex].value);
        return;
      }

      if (data === '\u001b[A') {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
        return;
      }

      if (data === '\u001b[B') {
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
      }
    };

    session.bind(onData);
    render();
  });
}

function chalkPointer(): string {
  return '>';
}

export async function promptTabbedMenu(message: string, tabs: MenuTab[], initialTabIndex = 0): Promise<string> {
  if (tabs.every((tab) => tab.items.length === 0)) {
    throw new Error('No tab items provided');
  }

  if (!process.stdin.isTTY || typeof (process.stdin as NodeJS.ReadStream).setRawMode !== 'function') {
    return promptMenu(
      message,
      tabs.flatMap((tab) => tab.items.map((item) => ({
        label: `${tab.label}: ${item.label}`,
        value: item.value,
        hint: item.hint,
      }))),
    );
  }

  const input = process.stdin as NodeJS.ReadStream;
  const output = process.stdout;
  let tabIndex = Math.min(Math.max(initialTabIndex, 0), tabs.length - 1);
  let itemIndex = 0;

  const normalizeItemIndex = () => {
    const items = tabs[tabIndex].items;
    if (items.length === 0) {
      const nextTab = tabs.findIndex((tab) => tab.items.length > 0);
      if (nextTab >= 0) {
        tabIndex = nextTab;
        itemIndex = 0;
      }
      return;
    }
    itemIndex = Math.min(itemIndex, items.length - 1);
  };

  normalizeItemIndex();

  return new Promise((resolve, reject) => {
    const render = () => {
      clearScreen(output);
      output.write(`${message}\n\n`);
      output.write(
        tabs
          .map((tab, index) => (index === tabIndex ? `[ ${tab.label} ]` : `  ${tab.label}  `))
          .join('    '),
      );
      output.write('\n\n');
      renderMenuItems(output, tabs[tabIndex].items, itemIndex);
      output.write('\nUse left/right to change tabs, up/down to move, Enter to select.\n');
    };

    const session = createRawMenuSession(input, output, resolve, reject);

    const onData = (chunk: Buffer | string) => {
      const data = chunk.toString();
      if (data === '\u0003') {
        session.cancel();
      }

      if (data === '\r' || data === '\n') {
        session.finish(tabs[tabIndex].items[itemIndex].value);
        return;
      }

      if (data === '\u001b[A') {
        const items = tabs[tabIndex].items;
        itemIndex = (itemIndex - 1 + items.length) % items.length;
        render();
        return;
      }

      if (data === '\u001b[B') {
        const items = tabs[tabIndex].items;
        itemIndex = (itemIndex + 1) % items.length;
        render();
        return;
      }

      if (data === '\u001b[C') {
        do {
          tabIndex = (tabIndex + 1) % tabs.length;
        } while (tabs[tabIndex].items.length === 0);
        normalizeItemIndex();
        render();
        return;
      }

      if (data === '\u001b[D') {
        do {
          tabIndex = (tabIndex - 1 + tabs.length) % tabs.length;
        } while (tabs[tabIndex].items.length === 0);
        normalizeItemIndex();
        render();
      }
    };

    session.bind(onData);
    render();
  });
}
