import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

type SpawnSyncResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
  pid: number;
  output: unknown[];
  signal: null;
};

const mockSpawnSync = jest.fn<(...args: any[]) => SpawnSyncResult>();
const mockSpawn = jest.fn<(...args: any[]) => any>();

jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

let currentPlatform: 'linux' | 'macos' | 'windows' = 'linux';

jest.unstable_mockModule('../src/service/platform.js', () => ({
  detectPlatform: () => currentPlatform,
  getServiceName: () => 'envcp',
  getUnitInstallPath: (p: 'linux' | 'macos' | 'windows') => {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    if (p === 'linux') {
      return path.join(home, '.config', 'systemd', 'user', 'envcp.service');
    }
    if (p === 'macos') {
      return path.join(home, 'Library', 'LaunchAgents', 'com.envcp.plist');
    }
    return path.join(home, '.envcp', 'envcp-service.bat');
  },
}));

const svc = await import('../src/service/index.js');
const {
  installService,
  uninstallService,
  startService,
  stopService,
  statusService,
  logsService,
} = svc;

function okResult(stdout = 'ok'): SpawnSyncResult {
  return {
    status: 0,
    stdout,
    stderr: '',
    pid: 1,
    output: [],
    signal: null,
  };
}

function failResult(code = 1, stderr = 'err'): SpawnSyncResult {
  return {
    status: code,
    stdout: '',
    stderr,
    pid: 1,
    output: [],
    signal: null,
  };
}

describe('service/index', () => {
  let tmpDir: string;
  let cfgPath: string;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-svc-idx-'));
    process.env.HOME = tmpDir;
    delete process.env.USERPROFILE;
    cfgPath = path.join(tmpDir, 'service.yaml');
    mockSpawnSync.mockReset();
    mockSpawn.mockReset();
    mockSpawnSync.mockReturnValue(okResult());
    mockSpawn.mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.pid = 999;
      return child;
    });
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function setPlatform(p: 'linux' | 'macos' | 'windows') {
    currentPlatform = p;
  }

  describe('installService (linux)', () => {
    beforeEach(() => setPlatform('linux'));

    it('writes a systemd unit file, reloads, and enables when autostart=true', async () => {
      const result = await installService({ configPath: cfgPath });
      expect(result.ok).toBe(true);

      const unitPath = path.join(tmpDir, '.config', 'systemd', 'user', 'envcp.service');
      const body = await fs.readFile(unitPath, 'utf-8');
      expect(body).toContain('[Service]');

      // daemon-reload + enable invocations
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'systemctl',
        ['--user', 'daemon-reload'],
        expect.any(Object),
      );
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'systemctl',
        ['--user', 'enable', 'envcp.service'],
        expect.any(Object),
      );
    });

    it('returns daemon-reload failure early', async () => {
      mockSpawnSync.mockImplementationOnce(() => failResult(3, 'reload boom'));
      const result = await installService({ configPath: cfgPath });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('daemon-reload');
    });

    it('returns enable failure when autostart=true', async () => {
      // first call (reload) ok, second (enable) fails
      mockSpawnSync
        .mockImplementationOnce(() => okResult())
        .mockImplementationOnce(() => failResult(4));
      const result = await installService({ configPath: cfgPath });
      expect(result.ok).toBe(false);
    });

    it('starts the service when now=true', async () => {
      const result = await installService({ configPath: cfgPath, now: true });
      expect(result.ok).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'systemctl',
        ['--user', 'start', 'envcp.service'],
        expect.any(Object),
      );
    });

    it('skips enable when autostart=false', async () => {
      // write config with autostart=false
      await fs.mkdir(path.dirname(cfgPath), { recursive: true });
      await fs.writeFile(cfgPath, 'autostart: false\n');
      mockSpawnSync.mockClear();
      await installService({ configPath: cfgPath });
      const calls = mockSpawnSync.mock.calls.map((c) => (c[1] as string[]).join(' '));
      expect(calls).not.toContain('--user enable envcp.service');
    });

    it('persists the config file when it does not exist yet', async () => {
      const target = path.join(tmpDir, 'new-service.yaml');
      await installService({ configPath: target });
      const body = await fs.readFile(target, 'utf-8');
      expect(body.length).toBeGreaterThan(0);
    });

    it('does not overwrite config file when it already exists', async () => {
      await fs.mkdir(path.dirname(cfgPath), { recursive: true });
      await fs.writeFile(cfgPath, 'existing: true\n');
      const result = await installService({ configPath: cfgPath });
      expect(result.ok).toBe(true);
      const body = await fs.readFile(cfgPath, 'utf-8');
      expect(body).toBe('existing: true\n');
    });

    it('works when called with no arguments (uses defaults)', async () => {
      const result = await installService();
      expect(result.ok).toBe(true);
    });
  });

  describe('installService (macos)', () => {
    beforeEach(() => setPlatform('macos'));

    it('writes a launchd plist and does not invoke launchctl by default', async () => {
      const result = await installService({ configPath: cfgPath });
      expect(result.ok).toBe(true);
      const unit = path.join(tmpDir, 'Library', 'LaunchAgents', 'com.envcp.plist');
      const body = await fs.readFile(unit, 'utf-8');
      expect(body).toContain('<plist');
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });

    it('loads the plist when now=true', async () => {
      const result = await installService({ configPath: cfgPath, now: true });
      expect(result.ok).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'launchctl',
        ['load', '-w', expect.stringContaining('com.envcp.plist')],
        expect.any(Object),
      );
    });
  });

  describe('installService (windows)', () => {
    beforeEach(() => setPlatform('windows'));

    it('writes a wrapper batch and registers a scheduled task', async () => {
      const result = await installService({ configPath: cfgPath });
      expect(result.ok).toBe(true);
      const batPath = path.join(tmpDir, '.envcp', 'envcp-service.bat');
      const body = await fs.readFile(batPath, 'utf-8');
      expect(body).toContain('@echo off');
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'schtasks',
        expect.arrayContaining(['/Create', '/TN', 'EnvCP']),
        expect.any(Object),
      );
    });

    it('runs the task when now=true', async () => {
      const result = await installService({ configPath: cfgPath, now: true });
      expect(result.ok).toBe(true);
      const commands = mockSpawnSync.mock.calls.map((c) => (c[1] as string[]).join(' '));
      expect(commands.some((c) => c.startsWith('/Run'))).toBe(true);
    });

    it('returns failure if schtasks create fails', async () => {
      mockSpawnSync.mockImplementationOnce(() => failResult(7));
      const result = await installService({ configPath: cfgPath, now: true });
      expect(result.ok).toBe(false);
    });

    it('skips schtasks when autostart=false and now=false', async () => {
      await fs.mkdir(path.dirname(cfgPath), { recursive: true });
      await fs.writeFile(cfgPath, 'autostart: false\n');
      mockSpawnSync.mockClear();
      const result = await installService({ configPath: cfgPath });
      expect(result.ok).toBe(true);
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('uninstallService', () => {
    it('removes the systemd unit on linux', async () => {
      setPlatform('linux');
      const unitPath = path.join(tmpDir, '.config', 'systemd', 'user', 'envcp.service');
      await fs.mkdir(path.dirname(unitPath), { recursive: true });
      await fs.writeFile(unitPath, 'placeholder');
      const result = await uninstallService();
      expect(result.ok).toBe(true);
      await expect(fs.stat(unitPath)).rejects.toThrow();
    });

    it('returns ok even when unit file is absent on linux', async () => {
      setPlatform('linux');
      const result = await uninstallService();
      expect(result.ok).toBe(true);
    });

    it('unloads launchd plist on macos', async () => {
      setPlatform('macos');
      const unit = path.join(tmpDir, 'Library', 'LaunchAgents', 'com.envcp.plist');
      await fs.mkdir(path.dirname(unit), { recursive: true });
      await fs.writeFile(unit, 'placeholder');
      const result = await uninstallService();
      expect(result.ok).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'launchctl',
        ['unload', '-w', unit],
        expect.any(Object),
      );
    });

    it('returns ok on macos when unit missing', async () => {
      setPlatform('macos');
      const result = await uninstallService();
      expect(result.ok).toBe(true);
    });

    it('removes scheduled task on windows without bat file present', async () => {
      setPlatform('windows');
      const result = await uninstallService();
      expect(result.ok).toBe(true);
    });

    it('removes scheduled task on windows', async () => {
      setPlatform('windows');
      const bat = path.join(tmpDir, '.envcp', 'envcp-service.bat');
      await fs.mkdir(path.dirname(bat), { recursive: true });
      await fs.writeFile(bat, 'placeholder');
      const result = await uninstallService();
      expect(result.ok).toBe(true);
      const calls = mockSpawnSync.mock.calls.map((c) => (c[1] as string[]).join(' '));
      expect(calls.some((c) => c.includes('/Delete'))).toBe(true);
    });
  });

  describe('startService', () => {
    it('runs systemctl start on linux', async () => {
      setPlatform('linux');
      const result = await startService();
      expect(result.ok).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'systemctl',
        ['--user', 'start', 'envcp.service'],
        expect.any(Object),
      );
    });

    it('runs launchctl load on macos', async () => {
      setPlatform('macos');
      const result = await startService();
      expect(result.ok).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'launchctl',
        ['load', '-w', expect.any(String)],
        expect.any(Object),
      );
    });

    it('runs schtasks /Run on windows', async () => {
      setPlatform('windows');
      const result = await startService();
      expect(result.ok).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'schtasks',
        ['/Run', '/TN', 'EnvCP'],
        expect.any(Object),
      );
    });
  });

  describe('stopService', () => {
    it('runs systemctl stop on linux', async () => {
      setPlatform('linux');
      await stopService();
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'systemctl',
        ['--user', 'stop', 'envcp.service'],
        expect.any(Object),
      );
    });

    it('runs launchctl unload on macos', async () => {
      setPlatform('macos');
      await stopService();
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'launchctl',
        ['unload', '-w', expect.any(String)],
        expect.any(Object),
      );
    });

    it('runs schtasks /End on windows', async () => {
      setPlatform('windows');
      await stopService();
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'schtasks',
        ['/End', '/TN', 'EnvCP'],
        expect.any(Object),
      );
    });
  });

  describe('statusService', () => {
    it('runs systemctl status on linux', async () => {
      setPlatform('linux');
      await statusService();
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'systemctl',
        ['--user', 'status', 'envcp.service', '--no-pager'],
        expect.any(Object),
      );
    });

    it('runs launchctl list on macos', async () => {
      setPlatform('macos');
      await statusService();
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'launchctl',
        ['list', 'com.envcp'],
        expect.any(Object),
      );
    });

    it('runs schtasks /Query on windows', async () => {
      setPlatform('windows');
      await statusService();
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'schtasks',
        ['/Query', '/TN', 'EnvCP', '/V', '/FO', 'LIST'],
        expect.any(Object),
      );
    });
  });

  describe('logsService', () => {
    it('uses journalctl on linux with no argument (default follow=false)', async () => {
      setPlatform('linux');
      const result = await logsService();
      expect(result.ok).toBe(true);
    });

    it('uses journalctl on linux (no-follow)', async () => {
      setPlatform('linux');
      const result = await logsService(false);
      expect(result.ok).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'journalctl',
        ['--user', '-u', 'envcp.service', '--no-pager'],
        expect.any(Object),
      );
    });

    it('streams journalctl on linux when follow=true', async () => {
      setPlatform('linux');
      const result = await logsService(true);
      expect(result.ok).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'journalctl',
        expect.arrayContaining(['-f']),
        expect.any(Object),
      );
    });

    it('returns failure when macos log file is missing', async () => {
      setPlatform('macos');
      const result = await logsService(false);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('No log file');
    });

    it('reads existing macos log file', async () => {
      setPlatform('macos');
      const logPath = path.join(tmpDir, '.envcp', 'service.log');
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.writeFile(logPath, 'hello-from-log');
      const result = await logsService(false);
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain('hello-from-log');
    });

    it('streams tail when follow=true on macos', async () => {
      setPlatform('macos');
      const logPath = path.join(tmpDir, '.envcp', 'service.log');
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.writeFile(logPath, 'x');
      const result = await logsService(true);
      expect(result.ok).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'tail',
        ['-f', logPath],
        expect.any(Object),
      );
    });

    it('uses PowerShell Get-Content on windows follow', async () => {
      setPlatform('windows');
      const logPath = path.join(tmpDir, '.envcp', 'service.log');
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.writeFile(logPath, 'win');
      const result = await logsService(true);
      expect(result.ok).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'powershell',
        expect.arrayContaining(['-Command']),
        expect.any(Object),
      );
    });
  });

  describe('runCommand error paths', () => {
    it('surfaces spawnSync thrown error', async () => {
      setPlatform('linux');
      mockSpawnSync.mockImplementationOnce(() => {
        throw new Error('exec denied');
      });
      const result = await startService();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('exec denied');
    });

    it('surfaces result.error object', async () => {
      setPlatform('linux');
      mockSpawnSync.mockImplementationOnce(() => ({
        status: null,
        stdout: '',
        stderr: '',
        pid: 0,
        output: [],
        signal: null,
        error: new Error('ENOENT'),
      }));
      const result = await startService();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('ENOENT');
    });

    it('surfaces non-zero exit code', async () => {
      setPlatform('linux');
      mockSpawnSync.mockImplementationOnce(() => failResult(2));
      const result = await startService();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('exited 2');
    });

    it('treats missing status as failure', async () => {
      setPlatform('linux');
      mockSpawnSync.mockImplementationOnce(() => ({
        status: null,
        stdout: '',
        stderr: '',
        pid: 0,
        output: [],
        signal: null,
      }));
      const result = await startService();
      expect(result.ok).toBe(false);
    });

    it('surfaces non-Error thrown value from spawnSync', async () => {
      setPlatform('linux');
      mockSpawnSync.mockImplementationOnce(() => {
        throw 'string-error';
      });
      const result = await startService();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('string-error');
    });
  });
});
