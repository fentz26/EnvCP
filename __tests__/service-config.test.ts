import { jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_SERVICE_CONFIG,
  getServiceHome,
  getServiceConfigPath,
  getServiceLogPath,
  getServiceErrorLogPath,
  loadServiceConfig,
  saveServiceConfig,
  mergeServiceConfig,
} from '../src/service/config.js';

describe('service/config', () => {
  let tmpDir: string;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-svc-cfg-'));
    process.env.HOME = tmpDir;
    delete process.env.USERPROFILE;
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('path helpers', () => {
    it('getServiceHome uses HOME env', () => {
      expect(getServiceHome()).toBe(path.join(tmpDir, '.envcp'));
    });

    it('falls back to USERPROFILE when HOME is absent', () => {
      delete process.env.HOME;
      process.env.USERPROFILE = '/tmp/profile';
      expect(getServiceHome()).toBe(path.join('/tmp/profile', '.envcp'));
    });

    it('falls back to os.homedir() when HOME and USERPROFILE both absent', () => {
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      expect(getServiceHome()).toBe(path.join(os.homedir(), '.envcp'));
    });

    it('getServiceConfigPath returns service.yaml under home', () => {
      expect(getServiceConfigPath()).toBe(path.join(tmpDir, '.envcp', 'service.yaml'));
    });

    it('getServiceLogPath returns service.log under home', () => {
      expect(getServiceLogPath()).toBe(path.join(tmpDir, '.envcp', 'service.log'));
    });

    it('getServiceErrorLogPath returns service.err.log under home', () => {
      expect(getServiceErrorLogPath()).toBe(path.join(tmpDir, '.envcp', 'service.err.log'));
    });
  });

  describe('loadServiceConfig', () => {
    it('returns defaults when no file exists', async () => {
      const cfg = await loadServiceConfig(path.join(tmpDir, 'missing.yaml'));
      expect(cfg).toEqual(DEFAULT_SERVICE_CONFIG);
    });

    it('uses getServiceConfigPath when no path passed and file missing', async () => {
      const cfg = await loadServiceConfig();
      expect(cfg).toEqual(DEFAULT_SERVICE_CONFIG);
    });

    it('loads and merges a yaml config', async () => {
      const p = path.join(tmpDir, 'service.yaml');
      await fs.writeFile(
        p,
        'server:\n  port: 9999\n  host: 0.0.0.0\n  mode: rest\nautostart: false\n',
      );
      const cfg = await loadServiceConfig(p);
      expect(cfg.server.port).toBe(9999);
      expect(cfg.server.host).toBe('0.0.0.0');
      expect(cfg.server.mode).toBe('rest');
      expect(cfg.autostart).toBe(false);
      expect(cfg.restart_on_failure).toBe(DEFAULT_SERVICE_CONFIG.restart_on_failure);
    });

    it('treats empty yaml file as defaults', async () => {
      const p = path.join(tmpDir, 'empty.yaml');
      await fs.writeFile(p, '');
      const cfg = await loadServiceConfig(p);
      expect(cfg).toEqual(DEFAULT_SERVICE_CONFIG);
    });

    it('loads a json config when extension is .json', async () => {
      const p = path.join(tmpDir, 'service.json');
      await fs.writeFile(
        p,
        JSON.stringify({ server: { port: 1234, api_key: 'secret' }, log_level: 'debug' }),
      );
      const cfg = await loadServiceConfig(p);
      expect(cfg.server.port).toBe(1234);
      expect(cfg.server.api_key).toBe('secret');
      expect(cfg.log_level).toBe('debug');
    });
  });

  describe('mergeServiceConfig', () => {
    it('fills all missing values with defaults', () => {
      const merged = mergeServiceConfig({});
      expect(merged).toEqual({ ...DEFAULT_SERVICE_CONFIG, working_directory: undefined });
    });

    it('preserves partial overrides without losing defaults', () => {
      const merged = mergeServiceConfig({
        server: { port: 5555 } as any,
        autostart: false,
      });
      expect(merged.server.port).toBe(5555);
      expect(merged.server.host).toBe(DEFAULT_SERVICE_CONFIG.server.host);
      expect(merged.autostart).toBe(false);
      expect(merged.restart_on_failure).toBe(DEFAULT_SERVICE_CONFIG.restart_on_failure);
    });

    it('keeps working_directory when provided', () => {
      const merged = mergeServiceConfig({ working_directory: '/srv/app' });
      expect(merged.working_directory).toBe('/srv/app');
    });
  });

  describe('saveServiceConfig', () => {
    it('writes yaml by default and creates parent directory', async () => {
      const p = path.join(tmpDir, 'nested', 'service.yaml');
      const returned = await saveServiceConfig({ ...DEFAULT_SERVICE_CONFIG }, p);
      expect(returned).toBe(p);
      const body = await fs.readFile(p, 'utf-8');
      expect(body).toContain('mode: auto');
    });

    it('writes json when path ends with .json', async () => {
      const p = path.join(tmpDir, 'service.json');
      await saveServiceConfig({ ...DEFAULT_SERVICE_CONFIG }, p);
      const body = await fs.readFile(p, 'utf-8');
      expect(JSON.parse(body).server.port).toBe(DEFAULT_SERVICE_CONFIG.server.port);
    });

    it('applies 0o600 permissions on unix-like systems', async () => {
      const p = path.join(tmpDir, 'service.yaml');
      await saveServiceConfig({ ...DEFAULT_SERVICE_CONFIG }, p);
      const stat = await fs.stat(p);
      if (process.platform !== 'win32') {
        expect(stat.mode & 0o777).toBe(0o600);
      }
    });

    it('uses default path when none supplied', async () => {
      const returned = await saveServiceConfig({ ...DEFAULT_SERVICE_CONFIG });
      expect(returned).toBe(getServiceConfigPath());
      await fs.rm(getServiceHome(), { recursive: true, force: true });
    });
  });
});
