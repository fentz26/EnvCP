import * as path from 'path';
import { resolveLogPath } from '../src/storage/index';
import { AuditConfig } from '../src/types';

const makeAudit = (log_path?: string): AuditConfig => ({
  enabled: true,
  retain_days: 30,
  fields: {
    timestamp: true,
    operation: true,
    variable: true,
    source: true,
    success: true,
    message: true,
    session_id: true,
    client_id: true,
    client_type: true,
    ip: true,
  },
  hmac: false,
  hmac_key_path: '.envcp/.audit-hmac-key',
  hmac_chain: false,
  log_path,
  protection: 'none',
});

describe('resolveLogPath (issue #204 phase 1)', () => {
  const projectPath = '/tmp/proj';

  it('defaults to <project>/.envcp/logs when log_path is unset', () => {
    expect(resolveLogPath(makeAudit(), projectPath)).toBe(path.join(projectPath, '.envcp', 'logs'));
  });

  it('defaults when audit is entirely undefined', () => {
    expect(resolveLogPath(undefined, projectPath)).toBe(path.join(projectPath, '.envcp', 'logs'));
  });

  it('resolves project:REL relative to projectPath', () => {
    expect(resolveLogPath(makeAudit('project:custom/logs'), projectPath))
      .toBe(path.resolve(projectPath, 'custom/logs'));
  });

  it('rejects project: paths that escape the project directory', () => {
    expect(() => resolveLogPath(makeAudit('project:../outside'), projectPath))
      .toThrow(/escapes project directory/);
  });

  it('expands ~ against $HOME', () => {
    const origHome = process.env.HOME;
    process.env.HOME = '/home/tester';
    try {
      expect(resolveLogPath(makeAudit('~/logs/envcp'), projectPath))
        .toBe('/home/tester/logs/envcp');
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome; else delete process.env.HOME;
    }
  });

  it('returns absolute paths unchanged', () => {
    expect(resolveLogPath(makeAudit('/var/log/envcp'), projectPath)).toBe('/var/log/envcp');
  });

  it('treats other relative paths as project-relative', () => {
    expect(resolveLogPath(makeAudit('alt/logs'), projectPath))
      .toBe(path.resolve(projectPath, 'alt/logs'));
  });
});
