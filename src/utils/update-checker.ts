import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';

const GITHUB_REPO = 'fentz26/EnvCP';
const CACHE_FILE = '.envcp/.update-cache.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface VersionInfo {
  latest: string;
  current: string;
  updateAvailable: boolean;
  critical: boolean;
  advisory?: {
    id: string;
    summary: string;
    severity: string;
    url: string;
  };
}

export interface CachedCheck {
  timestamp: number;
  latest: string;
  critical: boolean;
  advisory?: { id: string; summary: string; severity: string; url: string };
}

export interface ReleaseInfo {
  tag: string;
  critical: boolean;
  body: string;
  url: string;
}

export function getCurrentVersion(): string {
  try {
    /* c8 ignore next -- ts-jest ESM __dirname source-mapping artifact */
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    /* c8 ignore next */
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    /* c8 ignore next */
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function parseRelease(data: unknown): ReleaseInfo {
  const obj = data as Record<string, unknown>;
  const tag = (typeof obj.tag_name === 'string' ? obj.tag_name : '').replace(/^v/, '');
  const body = typeof obj.body === 'string' ? obj.body : '';
  const critical = /\[critical\]|severity:\s*critical|🚨/i.test(body);
  const url = typeof obj.html_url === 'string' ? obj.html_url : '';
  return { tag, critical, body, url };
}

export function extractAdvisory(body: string, url: string): { id: string; summary: string; severity: string; url: string } | undefined {
  const advisoryIdPattern = /advisory[_\s-]?id:\s*(\S+)/i;
  const envcpIdPattern = /(ENVCP-\d{4}-\d+)/i;
  const severityPattern = /severity:\s*(critical|high|medium|low)/i;
  const advMatch = advisoryIdPattern.exec(body) ?? envcpIdPattern.exec(body);
  const sevMatch = severityPattern.exec(body);

  if (!advMatch && !sevMatch) return undefined;

  const lines = body.split('\n').filter(l => l.trim().length > 0);
  const summaryLine = lines.find(l => /summary|description|fixes|security/i.test(l) && l.length > 10 && l.length < 200);

  return {
    id: advMatch ? advMatch[1] : 'N/A',
    summary: summaryLine ? summaryLine.replace(/^#+\s*/, '').trim() : 'Security update available',
    severity: sevMatch ? sevMatch[1].toLowerCase() : 'medium',
    url: url || `https://github.com/${GITHUB_REPO}/security/advisories`,
  };
}

export function getCachedResult(projectPath: string): CachedCheck | null {
  try {
    const cachePath = path.join(projectPath, CACHE_FILE);
    if (!fs.existsSync(cachePath)) return null;
    const cached: CachedCheck = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

export function writeCache(projectPath: string, data: CachedCheck): void {
  try {
    const cachePath = path.join(projectPath, CACHE_FILE);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  /* c8 ignore next -- cache write errors are silently ignored */
  } catch { /* ignore */ }
}

export async function fetchReleases(perPage = 50): Promise<ReleaseInfo[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases?per_page=${perPage}`,
      method: 'GET',
      headers: {
        'User-Agent': 'envcp-update-checker',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode !== 200 || !Array.isArray(data)) {
            reject(new Error((data as Record<string, unknown>).message as string || `GitHub API returned ${res.statusCode}`));
            return;
          }
          resolve((data as unknown[]).map(parseRelease));
        } catch { reject(new Error('Failed to parse response')); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

export type ReleaseChannel = 'latest' | 'experimental' | 'canary';

export function filterByChannel(releases: ReleaseInfo[], channel: ReleaseChannel): ReleaseInfo[] {
  return releases.filter(r => {
    if (channel === 'experimental') return r.tag.includes('-exp.');
    if (channel === 'canary') return r.tag.includes('-canary.');
    return !r.tag.includes('-exp.') && !r.tag.includes('-canary.') && !r.tag.includes('-beta');
  });
}

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'envcp-update-checker',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode !== 200) {
            reject(new Error(data.message || `GitHub API returned ${res.statusCode}`));
            return;
          }
          resolve(parseRelease(data));
        } catch { reject(new Error('Failed to parse response')); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

export async function checkForUpdate(projectPath?: string, fetcher?: () => Promise<ReleaseInfo>): Promise<VersionInfo> {
  const current = getCurrentVersion();
  const cwd = projectPath || process.cwd();

  const cached = getCachedResult(cwd);
  let latest: string;
  let critical = false;
  let advisoryBody = '';
  let advisoryUrl = '';
  let advisoryData: VersionInfo['advisory'];

  const doFetch = fetcher || fetchLatestRelease;

  if (cached) {
    latest = cached.latest;
    critical = cached.critical;
  } else {
    try {
      const release = await doFetch();
      latest = release.tag;
      critical = release.critical;
      advisoryBody = release.body;
      advisoryUrl = release.url;

      writeCache(cwd, {
        timestamp: Date.now(),
        latest,
        critical,
        advisory: extractAdvisory(advisoryBody, advisoryUrl),
      });
    } catch {
      return {
        latest: current,
        current,
        updateAvailable: false,
        critical: false,
      };
    }
  }

  const updateAvailable = compareVersions(latest, current) > 0;

  if (updateAvailable && advisoryBody) {
    advisoryData = extractAdvisory(advisoryBody, advisoryUrl);
  } else if (cached?.advisory && updateAvailable) {
    advisoryData = cached.advisory;
  }

  return {
    latest,
    current,
    updateAvailable,
    critical: updateAvailable && critical,
    advisory: advisoryData,
  };
}

export function formatUpdateMessage(info: VersionInfo): string {
  if (!info.updateAvailable) {
    return `EnvCP is up to date (v${info.current})`;
  }

  const lines: string[] = [];

  if (info.critical) {
    lines.push(`🚨 Critical security update available: v${info.latest} (current: v${info.current})`);
  } else {
    lines.push(`Update available: v${info.latest} (current: v${info.current})`);
  }

  if (info.advisory) {
    lines.push(`  Advisory: ${info.advisory.id} [${info.advisory.severity}]`);
    lines.push(`  ${info.advisory.summary}`);
    if (info.advisory.url) {
      lines.push(`  ${info.advisory.url}`);
    }
  }

  lines.push('', '  Run: npm update -g @fentz26/envcp');

  return lines.join('\n');
}

export async function logUpdateCheck(projectPath: string, info: VersionInfo): Promise<void> {
  try {
    const logDir = path.join(projectPath, '.envcp', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, 'audit.log');
    const line = `${new Date().toISOString()} UPDATE_CHECK current=${info.current} latest=${info.latest} available=${info.updateAvailable}\n`;
    fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
  /* c8 ignore next -- log write errors are silently ignored */
  } catch { /* ignore */ }
}
