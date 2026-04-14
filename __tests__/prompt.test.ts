import { jest } from '@jest/globals';

// Mock readline before importing prompt module
const mockCreateInterface = jest.fn();
const mockQuestion = jest.fn();
const mockClose = jest.fn();
const mockOn = jest.fn();
const mockOnce = jest.fn();

jest.unstable_mockModule('readline', () => ({
  createInterface: mockCreateInterface,
}));

const { promptPassword, promptInput, promptConfirm, promptList, ListChoice } = await import('../src/utils/prompt.js');

describe('prompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateInterface.mockReturnValue({
      question: mockQuestion,
      close: mockClose,
      on: mockOn,
      once: mockOnce,
    });
  });

  describe('promptInput', () => {
    it('should return user input', async () => {
      const promise = promptInput('Enter name:');
      expect(mockQuestion).toHaveBeenCalledWith('Enter name: ', expect.any(Function));
      const callback = mockQuestion.mock.calls[0][1];
      callback('Alice');
      await expect(promise).resolves.toBe('Alice');
      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle empty input', async () => {
      const promise = promptInput('Enter value:');
      const callback = mockQuestion.mock.calls[0][1];
      callback('');
      await expect(promise).resolves.toBe('');
    });
  });

  describe('promptConfirm', () => {
    it('should return true for "y"', async () => {
      const promise = promptConfirm('Continue?');
      const callback = mockQuestion.mock.calls[0][1];
      callback('y');
      await expect(promise).resolves.toBe(true);
    });

    it('should return true for "yes"', async () => {
      const promise = promptConfirm('Continue?');
      const callback = mockQuestion.mock.calls[0][1];
      callback('yes');
      await expect(promise).resolves.toBe(true);
    });

    it('should return false for "n"', async () => {
      const promise = promptConfirm('Continue?');
      const callback = mockQuestion.mock.calls[0][1];
      callback('n');
      await expect(promise).resolves.toBe(false);
    });

    it('should return default value when input empty', async () => {
      const promise = promptConfirm('Continue?', true);
      const callback = mockQuestion.mock.calls[0][1];
      callback('');
      await expect(promise).resolves.toBe(true);
    });
  });

  describe('promptList', () => {
    const choices: ListChoice[] = [
      { name: 'Option A', value: 'a' },
      { name: 'Option B', value: 'b' },
      { name: 'Option C', value: 'c' },
    ];

    it('should return selected value by number', async () => {
      const promise = promptList('Choose:', choices);
      const callback = mockQuestion.mock.calls[0][1];
      callback('2');
      await expect(promise).resolves.toBe('b');
    });

    it('should use default when empty input', async () => {
      const promise = promptList('Choose:', choices, 'b');
      const callback = mockQuestion.mock.calls[0][1];
      callback('');
      await expect(promise).resolves.toBe('b');
    });

    it('should reprompt on invalid input', async () => {
      let callCount = 0;
      mockQuestion.mockImplementation((_, cb) => {
        if (callCount === 0) {
          cb('invalid');
          callCount++;
        } else {
          cb('1');
        }
      });
      const promise = promptList('Choose:', choices);
      await expect(promise).resolves.toBe('a');
      expect(mockQuestion).toHaveBeenCalledTimes(2);
    });
  });

  describe('promptPassword', () => {
    let originalSetRawMode: any;
    let originalStdinOn: any;
    let originalStdinRemoveListener: any;
    let originalStdinResume: any;
    let originalStdoutWrite: any;

    beforeEach(() => {
      originalSetRawMode = (process.stdin as any).setRawMode;
      originalStdinOn = process.stdin.on;
      originalStdinRemoveListener = process.stdin.removeListener;
      originalStdinResume = process.stdin.resume;
      originalStdoutWrite = process.stdout.write;
    });

    afterEach(() => {
      (process.stdin as any).setRawMode = originalSetRawMode;
      process.stdin.on = originalStdinOn;
      process.stdin.removeListener = originalStdinRemoveListener;
      process.stdin.resume = originalStdinResume;
      process.stdout.write = originalStdoutWrite;
    });

    it('should return password via non-TTY fallback', async () => {
      // Simulate non-TTY environment where setRawMode is not a function
      (process.stdin as any).setRawMode = undefined;
      const stdoutWriteMock = jest.fn();
      process.stdout.write = stdoutWriteMock;

      const promise = promptPassword('Password:');
      // Should use readline.once('line')
      expect(mockOnce).toHaveBeenCalledWith('line', expect.any(Function));
      const callback = mockOnce.mock.calls[0][1];
      callback('secret123');
      await expect(promise).resolves.toBe('secret123');
      expect(mockClose).toHaveBeenCalled();
      expect(stdoutWriteMock).toHaveBeenCalledWith('Password: ');
    });

    it.skip('should handle Ctrl+C in TTY mode', async () => {
      const setRawModeMock = jest.fn();
      const stdinOnMock = jest.fn();
      const stdinRemoveListenerMock = jest.fn();
      const stdinResumeMock = jest.fn();
      const stdoutWriteMock = jest.fn();
      (process.stdin as any).setRawMode = setRawModeMock;
      process.stdin.on = stdinOnMock;
      process.stdin.removeListener = stdinRemoveListenerMock;
      process.stdin.resume = stdinResumeMock;
      process.stdout.write = stdoutWriteMock;

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
      const promise = promptPassword('Password:');
      // Should set raw mode and attach data listener
      expect(setRawModeMock).toHaveBeenCalledWith(true);
      expect(stdinOnMock).toHaveBeenCalledWith('data', expect.any(Function));
      const dataCallback = stdinOnMock.mock.calls[0][1];
      // Simulate Ctrl+C (unicode \u0003)
      expect(() => dataCallback('\u0003')).toThrow('process.exit');
      await expect(promise).rejects.toThrow('process.exit');
      mockExit.mockRestore();
    });

    it('should handle normal password entry in TTY mode', async () => {
      const setRawModeMock = jest.fn();
      const stdinOnMock = jest.fn();
      const stdinRemoveListenerMock = jest.fn();
      const stdinResumeMock = jest.fn();
      const stdoutWriteMock = jest.fn();
      (process.stdin as any).setRawMode = setRawModeMock;
      process.stdin.on = stdinOnMock;
      process.stdin.removeListener = stdinRemoveListenerMock;
      process.stdin.resume = stdinResumeMock;
      process.stdout.write = stdoutWriteMock;

      const promise = promptPassword('Password:');
      expect(setRawModeMock).toHaveBeenCalledWith(true);
      expect(stdinResumeMock).toHaveBeenCalled();
      expect(stdinOnMock).toHaveBeenCalledWith('data', expect.any(Function));
      const dataCallback = stdinOnMock.mock.calls[0][1];
      // Simulate typing 'p', 'a', 's', 's', then Enter
      dataCallback('p');
      expect(stdoutWriteMock).toHaveBeenCalledWith('*');
      dataCallback('a');
      expect(stdoutWriteMock).toHaveBeenCalledWith('*');
      dataCallback('s');
      expect(stdoutWriteMock).toHaveBeenCalledWith('*');
      dataCallback('s');
      expect(stdoutWriteMock).toHaveBeenCalledWith('*');
      dataCallback('\n'); // Enter
      const password = await promise;
      expect(password).toBe('pass');
      expect(stdinRemoveListenerMock).toHaveBeenCalledWith('data', dataCallback);
      expect(setRawModeMock).toHaveBeenCalledWith(false);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle backspace in TTY mode', async () => {
      const setRawModeMock = jest.fn();
      const stdinOnMock = jest.fn();
      const stdinRemoveListenerMock = jest.fn();
      const stdinResumeMock = jest.fn();
      const stdoutWriteMock = jest.fn();
      (process.stdin as any).setRawMode = setRawModeMock;
      process.stdin.on = stdinOnMock;
      process.stdin.removeListener = stdinRemoveListenerMock;
      process.stdin.resume = stdinResumeMock;
      process.stdout.write = stdoutWriteMock;

      const promise = promptPassword('Password:');
      expect(setRawModeMock).toHaveBeenCalledWith(true);
      expect(stdinResumeMock).toHaveBeenCalled();
      expect(stdinOnMock).toHaveBeenCalledWith('data', expect.any(Function));
      const dataCallback = stdinOnMock.mock.calls[0][1];
      // Simulate typing 'a', backspace, 'b', Enter
      dataCallback('a');
      expect(stdoutWriteMock).toHaveBeenCalledWith('*');
      stdoutWriteMock.mockClear();
      dataCallback('\b'); // backspace
      expect(stdoutWriteMock).toHaveBeenCalledWith('\b \b');
      dataCallback('b');
      expect(stdoutWriteMock).toHaveBeenCalledWith('*');
      dataCallback('\n'); // Enter
      const password = await promise;
      expect(password).toBe('b');
      expect(stdinRemoveListenerMock).toHaveBeenCalledWith('data', dataCallback);
      expect(setRawModeMock).toHaveBeenCalledWith(false);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle Ctrl+D (EOF)', async () => {
      const setRawModeMock = jest.fn();
      const stdinOnMock = jest.fn();
      const stdinRemoveListenerMock = jest.fn();
      const stdinResumeMock = jest.fn();
      const stdoutWriteMock = jest.fn();
      (process.stdin as any).setRawMode = setRawModeMock;
      process.stdin.on = stdinOnMock;
      process.stdin.removeListener = stdinRemoveListenerMock;
      process.stdin.resume = stdinResumeMock;
      process.stdout.write = stdoutWriteMock;

      const promise = promptPassword('Password:');
      const dataCallback = stdinOnMock.mock.calls[0][1];
      // Simulate Ctrl+D (unicode \u0004)
      dataCallback('\u0004');
      const password = await promise;
      expect(password).toBe('');
      expect(stdinRemoveListenerMock).toHaveBeenCalledWith('data', dataCallback);
      expect(setRawModeMock).toHaveBeenCalledWith(false);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should ignore backspace when value empty', async () => {
      const setRawModeMock = jest.fn();
      const stdinOnMock = jest.fn();
      const stdinRemoveListenerMock = jest.fn();
      const stdinResumeMock = jest.fn();
      const stdoutWriteMock = jest.fn();
      (process.stdin as any).setRawMode = setRawModeMock;
      process.stdin.on = stdinOnMock;
      process.stdin.removeListener = stdinRemoveListenerMock;
      process.stdin.resume = stdinResumeMock;
      process.stdout.write = stdoutWriteMock;

      const promise = promptPassword('Password:');
      const dataCallback = stdinOnMock.mock.calls[0][1];
      // Simulate backspace with no characters typed
      dataCallback('\b');
      // Should not write anything (no \b \b)
      expect(stdoutWriteMock).not.toHaveBeenCalledWith('\b \b');
      // Finish with Enter
      dataCallback('\n');
      const password = await promise;
      expect(password).toBe('');
      expect(stdinRemoveListenerMock).toHaveBeenCalledWith('data', dataCallback);
      expect(setRawModeMock).toHaveBeenCalledWith(false);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should ignore non-printable control characters', async () => {
      const setRawModeMock = jest.fn();
      const stdinOnMock = jest.fn();
      const stdinRemoveListenerMock = jest.fn();
      const stdinResumeMock = jest.fn();
      const stdoutWriteMock = jest.fn();
      (process.stdin as any).setRawMode = setRawModeMock;
      process.stdin.on = stdinOnMock;
      process.stdin.removeListener = stdinRemoveListenerMock;
      process.stdin.resume = stdinResumeMock;
      process.stdout.write = stdoutWriteMock;

      const promise = promptPassword('Password:');
      const dataCallback = stdinOnMock.mock.calls[0][1];
      // Simulate Ctrl+A (\u0001)
      dataCallback('\u0001');
      // Should not write anything
      expect(stdoutWriteMock).not.toHaveBeenCalledWith('*');
      // Finish with Enter
      dataCallback('\n');
      const password = await promise;
      expect(password).toBe('');
      expect(stdinRemoveListenerMock).toHaveBeenCalledWith('data', dataCallback);
      expect(setRawModeMock).toHaveBeenCalledWith(false);
      expect(mockClose).toHaveBeenCalled();
    });
  });
});