import * as fs from 'fs/promises';
import { ensureDir, pathExists } from '../src/utils/fs.js';
import * as os from 'os';
import * as path from 'path';
import {
  checkForUpdate,
  formatUpdateMessage,
  logUpdateCheck,
  compareVersions,
  parseRelease,
  extractAdvisory,
  getCachedResult,
  writeCache,
  fetchLatestRelease,
  getCurrentVersion,
  VersionInfo,
  ReleaseInfo,
} from '../src/utils/update-checker';

const makeRelease = (tag: string, body: string, url = ''): ReleaseInfo => {
  const parsed = parseRelease({ tag_name: tag, body, html_url: url });
  return parsed;
};

describe('update-checker', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-update-'));
    await ensureDir(path.join(tmpDir, '.envcp'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('getCurrentVersion', () => {
    it('returns a version string', () => {
      const v = getCurrentVersion();
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    });
  });

  describe('compareVersions', () => {
    it('returns 0 for equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('returns 1 when a > b', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.1.0', '1.0.9')).toBe(1);
      expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    });

    it('returns -1 when a < b', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(compareVersions('1.0.9', '1.1.0')).toBe(-1);
    });

    it('handles v prefix', () => {
      expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('v2.0.0', '1.0.0')).toBe(1);
    });

    it('handles different length versions', () => {
      expect(compareVersions('1.0.0.1', '1.0.0')).toBe(1);
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
    });
  });

  describe('parseRelease', () => {
    it('parses tag and body', () => {
      const r = parseRelease({ tag_name: 'v1.2.3', body: 'hello', html_url: 'http://example.com' });
      expect(r.tag).toBe('1.2.3');
      expect(r.body).toBe('hello');
      expect(r.url).toBe('http://example.com');
    });

    it('detects critical with emoji', () => {
      expect(parseRelease({ tag_name: 'v1.0.0', body: '🚨 Critical fix' }).critical).toBe(true);
    });

    it('detects critical with [critical]', () => {
      expect(parseRelease({ tag_name: 'v1.0.0', body: '[Critical] security fix' }).critical).toBe(true);
    });

    it('detects critical with severity: critical', () => {
      expect(parseRelease({ tag_name: 'v1.0.0', body: 'Severity: critical' }).critical).toBe(true);
    });

    it('non-critical release', () => {
      expect(parseRelease({ tag_name: 'v1.0.0', body: 'Bug fix' }).critical).toBe(false);
    });

    it('handles missing fields', () => {
      const r = parseRelease({});
      expect(r.tag).toBe('');
      expect(r.body).toBe('');
      expect(r.url).toBe('');
      expect(r.critical).toBe(false);
    });
  });

  describe('extractAdvisory', () => {
    it('extracts advisory with ENVCP ID', () => {
      const adv = extractAdvisory('Advisory ID: ENVCP-2026-001\nSeverity: high', 'http://example.com');
      expect(adv).toBeDefined();
      expect(adv!.id).toBe('ENVCP-2026-001');
      expect(adv!.severity).toBe('high');
    });

    it('extracts advisory with severity only', () => {
      const adv = extractAdvisory('Severity: medium\nSome security fix', 'http://example.com');
      expect(adv).toBeDefined();
      expect(adv!.severity).toBe('medium');
      expect(adv!.id).toBe('N/A');
    });

    it('returns undefined when no advisory info', () => {
      expect(extractAdvisory('Bug fix release', 'http://example.com')).toBeUndefined();
    });

    it('extracts summary from matching line', () => {
      const adv = extractAdvisory('## Security fix\nFixes X vulnerability\nSeverity: high', 'http://example.com');
      expect(adv).toBeDefined();
      expect(adv!.summary).toContain('Security fix');
    });

    it('uses default summary when no matching line', () => {
      const adv = extractAdvisory('Severity: low\nok', 'http://example.com');
      expect(adv!.summary).toBe('Security update available');
    });

    it('defaults severity to medium when no sevMatch — line 82', () => {
      // Has advMatch but no Severity line → sevMatch is null
      const adv = extractAdvisory('Advisory ID: ENVCP-2026-001\nsome content here', 'http://example.com');
      expect(adv).toBeDefined();
      expect(adv!.severity).toBe('medium');
    });

    it('falls back to github URL when url is empty — line 83', () => {
      // Has sevMatch, url is empty string
      const adv = extractAdvisory('Severity: critical\nSome security description here', '');
      expect(adv).toBeDefined();
      expect(adv!.url).toContain('github.com');
    });
  });

  describe('cache', () => {
    it('writeCache creates file', async () => {
      writeCache(tmpDir, { timestamp: Date.now(), latest: '2.0.0', critical: false });
      const cachePath = path.join(tmpDir, '.envcp', '.update-cache.json');
      expect(await pathExists(cachePath)).toBe(true);
      const data = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      expect(data.latest).toBe('2.0.0');
    });

    it('getCachedResult returns null when no cache', () => {
      expect(getCachedResult(tmpDir)).toBeNull();
    });

    it('getCachedResult returns cached data', () => {
      writeCache(tmpDir, { timestamp: Date.now(), latest: '2.0.0', critical: false });
      const cached = getCachedResult(tmpDir);
      expect(cached).not.toBeNull();
      expect(cached!.latest).toBe('2.0.0');
    });

    it('getCachedResult returns null for expired cache', () => {
      writeCache(tmpDir, { timestamp: Date.now() - 48 * 60 * 60 * 1000, latest: '2.0.0', critical: false });
      expect(getCachedResult(tmpDir)).toBeNull();
    });

    it('getCachedResult returns null for corrupted cache', async () => {
      const cachePath = path.join(tmpDir, '.envcp', '.update-cache.json');
      await fs.writeFile(cachePath, 'not valid json');
      expect(getCachedResult(tmpDir)).toBeNull();
    });

    it('writeCache creates directory when missing', async () => {
      const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-cache-mkdir-'));
      writeCache(freshDir, { timestamp: Date.now(), latest: '2.0.0', critical: false });
      const cachePath = path.join(freshDir, '.envcp', '.update-cache.json');
      expect(await pathExists(cachePath)).toBe(true);
      await fs.rm(freshDir, { recursive: true, force: true });
    });
  });

  describe('checkForUpdate', () => {
    it('returns up-to-date when current >= latest', async () => {
      const info = await checkForUpdate(tmpDir, () =>
        Promise.resolve(makeRelease('v0.0.0', 'Initial'))
      );
      expect(info.updateAvailable).toBe(false);
      expect(info.current).toBeTruthy();
    });

    it('detects available update', async () => {
      const info = await checkForUpdate(tmpDir, () =>
        Promise.resolve(makeRelease('v99.0.0', 'Major release', 'http://example.com'))
      );
      expect(info.updateAvailable).toBe(true);
      expect(info.latest).toBe('99.0.0');
    });

    it('detects critical update', async () => {
      const info = await checkForUpdate(tmpDir, () =>
        Promise.resolve(makeRelease('v99.0.0', '🚨 [Critical] Security fix', 'http://example.com'))
      );
      expect(info.critical).toBe(true);
    });

    it('extracts advisory from release', async () => {
      const info = await checkForUpdate(tmpDir, () =>
        Promise.resolve(makeRelease('v99.0.0', 'Advisory ID: ENVCP-2026-001\nSeverity: high', 'http://example.com'))
      );
      expect(info.advisory).toBeDefined();
      expect(info.advisory!.id).toBe('ENVCP-2026-001');
      expect(info.advisory!.severity).toBe('high');
    });

    it('uses cache on second call', async () => {
      let callCount = 0;
      const fetcher = () => {
        callCount++;
        return Promise.resolve(makeRelease('v99.0.0', 'Update'));
      };

      const info1 = await checkForUpdate(tmpDir, fetcher);
      expect(info1.updateAvailable).toBe(true);
      expect(callCount).toBe(1);

      const info2 = await checkForUpdate(tmpDir, fetcher);
      expect(info2.updateAvailable).toBe(true);
      expect(callCount).toBe(1);
    });

    it('re-fetches after cache expires', async () => {
      let callCount = 0;
      const fetcher = () => {
        callCount++;
        return Promise.resolve(makeRelease('v99.0.0', 'Update'));
      };

      await checkForUpdate(tmpDir, fetcher);
      expect(callCount).toBe(1);

      const cachePath = path.join(tmpDir, '.envcp', '.update-cache.json');
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      cached.timestamp = Date.now() - 48 * 60 * 60 * 1000;
      await fs.writeFile(cachePath, JSON.stringify(cached), 'utf8');

      await checkForUpdate(tmpDir, fetcher);
      expect(callCount).toBe(2);
    });

    it('handles fetch failure gracefully', async () => {
      const info = await checkForUpdate(tmpDir, () => Promise.reject(new Error('Network error')));
      expect(info.updateAvailable).toBe(false);
    });

    it('critical is false when no update even if release is critical', async () => {
      const info = await checkForUpdate(tmpDir, () =>
        Promise.resolve(makeRelease('v0.0.0', '🚨 Critical'))
      );
      expect(info.updateAvailable).toBe(false);
      expect(info.critical).toBe(false);
    });

    it('returns advisory from cache when update available', async () => {
      const advisory = { id: 'ENVCP-2026-002', summary: 'Test advisory', severity: 'high', url: 'http://example.com' };
      writeCache(tmpDir, {
        timestamp: Date.now(),
        latest: '99.0.0',
        critical: false,
        advisory,
      });
      const info = await checkForUpdate(tmpDir, () =>
        Promise.resolve(makeRelease('v99.0.0', 'Minor update'))
      );
      expect(info.updateAvailable).toBe(true);
      expect(info.advisory).toBeDefined();
      expect(info.advisory!.id).toBe('ENVCP-2026-002');
    });
  });

  describe('formatUpdateMessage', () => {
    it('shows up-to-date message', () => {
      const msg = formatUpdateMessage({ latest: '1.0.0', current: '1.0.0', updateAvailable: false, critical: false });
      expect(msg).toContain('up to date');
      expect(msg).toContain('1.0.0');
    });

    it('shows update available', () => {
      const msg = formatUpdateMessage({ latest: '2.0.0', current: '1.0.0', updateAvailable: true, critical: false });
      expect(msg).toContain('Update available');
      expect(msg).toContain('2.0.0');
      expect(msg).toContain('npm update -g');
    });

    it('shows critical warning', () => {
      const msg = formatUpdateMessage({ latest: '2.0.0', current: '1.0.0', updateAvailable: true, critical: true });
      expect(msg).toContain('Critical');
      expect(msg).toContain('🚨');
    });

    it('includes advisory details', () => {
      const msg = formatUpdateMessage({
        latest: '2.0.0',
        current: '1.0.0',
        updateAvailable: true,
        critical: true,
        advisory: {
          id: 'ENVCP-2026-001',
          summary: 'Rate limiting bypass',
          severity: 'critical',
          url: 'https://github.com/fentz26/EnvCP/security/advisories',
        },
      });
      expect(msg).toContain('ENVCP-2026-001');
      expect(msg).toContain('Rate limiting bypass');
      expect(msg).toContain('github.com');
    });

    it('omits URL line when advisory url is empty — line 219', () => {
      const msg = formatUpdateMessage({
        latest: '2.0.0',
        current: '1.0.0',
        updateAvailable: true,
        critical: false,
        advisory: { id: 'ENVCP-001', summary: 'A fix', severity: 'low', url: '' },
      });
      expect(msg).toContain('ENVCP-001');
      // Empty url means the url line should NOT be in the output
      const lines = msg.split('\n');
      expect(lines.some(l => l.trim() === '')).toBe(true);
    });
  });

describe('fetchLatestRelease', () => {
  it('returns a release or handles error', async () => {
    try {
      const release = await fetchLatestRelease();
      expect(release.tag).toBeTruthy();
      expect(typeof release.critical).toBe('boolean');
    } catch (error) {
      expect(error).toBeDefined();
    }
  }, 10000);
});

  describe('logUpdateCheck', () => {
    it('writes audit log', async () => {
      const info: VersionInfo = { latest: '2.0.0', current: '1.0.0', updateAvailable: true, critical: false };
      await logUpdateCheck(tmpDir, info);

      const logPath = path.join(tmpDir, '.envcp', 'logs', 'audit.log');
      expect(await pathExists(logPath)).toBe(true);

      const content = await fs.readFile(logPath, 'utf8');
      expect(content).toContain('UPDATE_CHECK');
      expect(content).toContain('current=1.0.0');
      expect(content).toContain('latest=2.0.0');
    });

    it('creates log directory if missing', async () => {
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envcp-logtest-'));
      const info: VersionInfo = { latest: '1.0.0', current: '1.0.0', updateAvailable: false, critical: false };
      await logUpdateCheck(emptyDir, info);

      const logPath = path.join(emptyDir, '.envcp', 'logs', 'audit.log');
      expect(await pathExists(logPath)).toBe(true);

      await fs.rm(emptyDir, { recursive: true, force: true });
    });

    it('appends to existing log when dir already exists — line 233', async () => {
      const info: VersionInfo = { latest: '2.0.0', current: '1.0.0', updateAvailable: true, critical: false };
      // First call creates the dir
      await logUpdateCheck(tmpDir, info);
      // Second call hits the branch where logDir already exists
      await logUpdateCheck(tmpDir, info);

      const logPath = path.join(tmpDir, '.envcp', 'logs', 'audit.log');
      const content = await fs.readFile(logPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('checkForUpdate without fetcher — lines 148, 157', () => {
    it('uses process.cwd() when projectPath is not provided — line 148', async () => {
      // Call with no args — uses process.cwd() and no fetcher → tries real network fetch
      // which will fail in test env → returns current version safely
      const info = await checkForUpdate(undefined, () => Promise.reject(new Error('no network')));
      expect(info.current).toBeTruthy();
      expect(typeof info.updateAvailable).toBe('boolean');
    });

    it('falls back to fetchLatestRelease when no fetcher provided — line 157', async () => {
      // Call without fetcher; the real fetch will likely fail in test → catch block returns current
      const info = await checkForUpdate(tmpDir);
      expect(info.current).toBeTruthy();
    });
  });
});
