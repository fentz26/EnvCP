import { matchesPattern, canAccess, isBlacklisted, validateVariableName, parseEnvFile } from '../src/config/manager';
import { EnvCPConfigSchema } from '../src/types';

describe('matchesPattern', () => {
  it('matches exact names', () => {
    expect(matchesPattern('API_KEY', 'API_KEY')).toBe(true);
    expect(matchesPattern('API_KEY', 'OTHER')).toBe(false);
  });

  it('matches wildcard patterns', () => {
    expect(matchesPattern('DB_SECRET', '*_SECRET')).toBe(true);
    expect(matchesPattern('DB_KEY', '*_SECRET')).toBe(false);
    expect(matchesPattern('ADMIN_TOKEN', 'ADMIN_*')).toBe(true);
  });

  it('does not treat dots as wildcards (regex escaping)', () => {
    expect(matchesPattern('DB_SECRET', 'DB.SECRET')).toBe(false);
    expect(matchesPattern('DBXSECRET', 'DB.SECRET')).toBe(false);
  });

  it('escapes other regex special chars', () => {
    expect(matchesPattern('A+B', 'A+B')).toBe(true);
    expect(matchesPattern('AB', 'A+B')).toBe(false);
    expect(matchesPattern('A?B', 'A?B')).toBe(true);
    expect(matchesPattern('AB', 'A?B')).toBe(false);
  });
});

describe('validateVariableName', () => {
  it('accepts valid names', () => {
    expect(validateVariableName('API_KEY')).toBe(true);
    expect(validateVariableName('_private')).toBe(true);
    expect(validateVariableName('a')).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(validateVariableName('123')).toBe(false);
    expect(validateVariableName('has space')).toBe(false);
    expect(validateVariableName('has-dash')).toBe(false);
    expect(validateVariableName('')).toBe(false);
  });
});

describe('canAccess / isBlacklisted', () => {
  const makeConfig = (overrides: Record<string, unknown> = {}) =>
    EnvCPConfigSchema.parse({ access: { ...overrides } });

  it('blacklists matching patterns', () => {
    const config = makeConfig({ blacklist_patterns: ['*_SECRET'] });
    expect(isBlacklisted('DB_SECRET', config)).toBe(true);
    expect(isBlacklisted('DB_KEY', config)).toBe(false);
  });

  it('denies access for denied patterns', () => {
    const config = makeConfig({ denied_patterns: ['ADMIN_*'] });
    expect(canAccess('ADMIN_KEY', config)).toBe(false);
    expect(canAccess('USER_KEY', config)).toBe(true);
  });

  it('restricts to allowed patterns when set', () => {
    const config = makeConfig({ allowed_patterns: ['APP_*'] });
    expect(canAccess('APP_KEY', config)).toBe(true);
    expect(canAccess('DB_KEY', config)).toBe(false);
  });
});

describe('parseEnvFile', () => {
  it('parses simple key=value pairs', () => {
    expect(parseEnvFile('KEY=value\nOTHER=123')).toEqual({ KEY: 'value', OTHER: '123' });
  });

  it('strips double quotes and unescapes backslash sequences', () => {
    expect(parseEnvFile('KEY="hello \\"world\\""')).toEqual({ KEY: 'hello "world"' });
    expect(parseEnvFile('KEY="path\\\\to\\\\file"')).toEqual({ KEY: 'path\\to\\file' });
  });

  it('strips single quotes literally', () => {
    expect(parseEnvFile("KEY='hello world'")).toEqual({ KEY: 'hello world' });
  });

  it('ignores comment lines', () => {
    expect(parseEnvFile('# comment\nKEY=value')).toEqual({ KEY: 'value' });
  });

  it('ignores lines without =', () => {
    expect(parseEnvFile('INVALID\nKEY=value')).toEqual({ KEY: 'value' });
  });

  it('ignores invalid variable names', () => {
    expect(parseEnvFile('123INVALID=value\nVALID=ok')).toEqual({ VALID: 'ok' });
  });
});

describe('sync.target validation', () => {
  it('accepts a relative sync target path', () => {
    const config = EnvCPConfigSchema.parse({ sync: { target: '.env' } });
    expect(config.sync.target).toBe('.env');
  });

  it('rejects an absolute sync target path', () => {
    expect(() => EnvCPConfigSchema.parse({ sync: { target: '/tmp/.env' } })).toThrow(
      'sync.target must be a relative path within the project directory'
    );
  });
});
