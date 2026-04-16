import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock child_process.spawn to control process lifecycle
const mockKill = jest.fn();
let mockProc: any;

jest.unstable_mockModule('child_process', () => ({
  spawn: jest.fn(() => {
    mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.kill = mockKill;
    mockProc.killed = false;
    return mockProc;
  }),
  exec: jest.fn((cmd: string, cb: Function) => cb(null, '', '')),
}));

// Dynamic imports after mock
const { BaseAdapter } = await import('../src/adapters/base');
const { EnvCPConfigSchema } = await import('../src/types');

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

class TimeoutTestAdapter extends BaseAdapter {
  protected registerTools(): void {
    this.registerDefaultTools();
  }
  runRunCommand(args: { command: string; variables: string[] }) {
    return this.runCommand(args);
  }
}

describe('BaseAdapter runCommand timeout', () => {
  let tmpDir: string;
  let adapter: TimeoutTestAdapter;

  beforeEach(async () => {
    jest.useFakeTimers();
    mockKill.mockReset();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-timeout-'));
    const config = EnvCPConfigSchema.parse({
      access: {
        allow_ai_read: true,
        allow_ai_write: true,
        allow_ai_execute: true,
        allow_ai_active_check: true,
      },
      encryption: { enabled: false },
      storage: { encrypted: false, path: '.envcp/store.json' },
    });
    adapter = new TimeoutTestAdapter(config, tmpDir);
    await adapter.init();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('kills process after 30s timeout and appends timeout message', async () => {
    const resultPromise = adapter.runRunCommand({ command: 'sleep 100', variables: [] });

    // Let async operations (dynamic import, storage reads) resolve before advancing timers
    await jest.advanceTimersByTimeAsync(30000);

    // The timeout callback should have fired: killed=true, proc.kill('SIGTERM')
    expect(mockKill).toHaveBeenCalledWith('SIGTERM');

    // Simulate the process closing after being killed
    mockProc.emit('close', null);

    const result = await resultPromise;
    expect(result.stderr).toContain('[Process killed: exceeded 30s timeout]');
  });

  it('sends SIGKILL if process is not killed after 5s grace period', async () => {
    const resultPromise = adapter.runRunCommand({ command: 'sleep 100', variables: [] });

    // Advance past the 30s timeout — fires SIGTERM
    await jest.advanceTimersByTimeAsync(30000);
    expect(mockKill).toHaveBeenCalledWith('SIGTERM');

    // Process is still alive (killed remains false)
    mockProc.killed = false;

    // Advance 5s for the SIGKILL fallback
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockKill).toHaveBeenCalledWith('SIGKILL');

    // Now the process closes
    mockProc.emit('close', null);
    const result = await resultPromise;
    expect(result.stderr).toContain('[Process killed: exceeded 30s timeout]');
  });

  it('does not send SIGKILL if process already killed', async () => {
    const resultPromise = adapter.runRunCommand({ command: 'sleep 100', variables: [] });

    // Advance past the 30s timeout
    await jest.advanceTimersByTimeAsync(30000);
    expect(mockKill).toHaveBeenCalledWith('SIGTERM');

    // Mark process as killed (SIGTERM succeeded)
    mockProc.killed = true;

    // Advance 5s — SIGKILL should NOT be sent because proc.killed is true
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockKill).not.toHaveBeenCalledWith('SIGKILL');

    // Close the process
    mockProc.emit('close', null);
    const result = await resultPromise;
    expect(result.stderr).toContain('[Process killed: exceeded 30s timeout]');
  });
});
