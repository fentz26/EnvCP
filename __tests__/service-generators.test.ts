import {
  buildServeArgs,
  generateSystemdUnit,
  generateLaunchdPlist,
  generateWindowsWrapperScript,
  GeneratorContext,
} from '../src/service/generators.js';
import { DEFAULT_SERVICE_CONFIG, ServiceConfig } from '../src/service/config.js';

function makeCtx(overrides: Partial<GeneratorContext> = {}): GeneratorContext {
  const config: ServiceConfig = {
    ...DEFAULT_SERVICE_CONFIG,
    ...(overrides.config || {}),
    server: {
      ...DEFAULT_SERVICE_CONFIG.server,
      ...((overrides.config as any)?.server || {}),
    },
  };
  return {
    execPath: '/opt/envcp/cli.js',
    nodePath: '/usr/bin/node',
    workingDirectory: '/srv/work',
    logFile: '/var/log/envcp.log',
    errorLogFile: '/var/log/envcp.err.log',
    config,
    ...overrides,
    config,
  };
}

describe('service/generators', () => {
  describe('buildServeArgs', () => {
    it('includes mode, port and host', () => {
      const args = buildServeArgs(DEFAULT_SERVICE_CONFIG);
      expect(args[0]).toBe('serve');
      expect(args).toEqual(
        expect.arrayContaining([
          '--mode',
          DEFAULT_SERVICE_CONFIG.server.mode,
          '--port',
          String(DEFAULT_SERVICE_CONFIG.server.port),
          '--host',
          DEFAULT_SERVICE_CONFIG.server.host,
        ]),
      );
    });

    it('adds --api-key when configured', () => {
      const cfg: ServiceConfig = {
        ...DEFAULT_SERVICE_CONFIG,
        server: { ...DEFAULT_SERVICE_CONFIG.server, api_key: 'k1' },
      };
      expect(buildServeArgs(cfg)).toEqual(expect.arrayContaining(['--api-key', 'k1']));
    });

    it('omits --api-key when missing', () => {
      expect(buildServeArgs(DEFAULT_SERVICE_CONFIG)).not.toContain('--api-key');
    });
  });

  describe('generateSystemdUnit', () => {
    it('produces a unit file with ExecStart and logs', () => {
      const unit = generateSystemdUnit(makeCtx());
      expect(unit).toContain('[Unit]');
      expect(unit).toContain('[Service]');
      expect(unit).toContain('WorkingDirectory=/srv/work');
      expect(unit).toContain('ExecStart=/usr/bin/node /opt/envcp/cli.js serve');
      expect(unit).toContain('StandardOutput=append:/var/log/envcp.log');
      expect(unit).toContain('StandardError=append:/var/log/envcp.err.log');
      expect(unit).toContain('Restart=on-failure');
    });

    it('sets Restart=no when restart_on_failure is false', () => {
      const ctx = makeCtx();
      ctx.config.restart_on_failure = false;
      const unit = generateSystemdUnit(ctx);
      expect(unit).toContain('Restart=no');
    });
  });

  describe('generateLaunchdPlist', () => {
    it('produces a valid plist with program arguments', () => {
      const plist = generateLaunchdPlist(makeCtx());
      expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(plist).toContain('<string>com.envcp</string>');
      expect(plist).toContain('<string>/usr/bin/node</string>');
      expect(plist).toContain('<string>/opt/envcp/cli.js</string>');
      expect(plist).toContain('<key>RunAtLoad</key>');
    });

    it('sets RunAtLoad and KeepAlive from config', () => {
      const ctx = makeCtx();
      ctx.config.autostart = false;
      ctx.config.restart_on_failure = false;
      const plist = generateLaunchdPlist(ctx);
      expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/);
      expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<false\/>/);
    });

    it('escapes XML special characters in paths', () => {
      const ctx = makeCtx({ workingDirectory: '/tmp/a&b<c>"d\'' });
      const plist = generateLaunchdPlist(ctx);
      expect(plist).toContain('/tmp/a&amp;b&lt;c&gt;&quot;d&apos;');
      expect(plist).not.toContain('/tmp/a&b<c>');
    });
  });

  describe('generateWindowsWrapperScript', () => {
    it('produces a batch file with cd and executable invocation', () => {
      const script = generateWindowsWrapperScript(makeCtx());
      expect(script).toContain('@echo off');
      expect(script).toContain('NODE_ENV=production');
      expect(script).toContain('cd /d "/srv/work"');
      expect(script).toContain('"/usr/bin/node" "/opt/envcp/cli.js"');
      expect(script).toContain('>> "/var/log/envcp.log"');
    });

    it('quotes arguments containing spaces', () => {
      const ctx = makeCtx();
      ctx.config.server.host = 'my host';
      const script = generateWindowsWrapperScript(ctx);
      expect(script).toContain('"my host"');
    });
  });
});
