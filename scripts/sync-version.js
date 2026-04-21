#!/usr/bin/env node
/**
 * sync-version.js
 *
 * Reads VERSION from the repo root and propagates it to all release metadata
 * files that should stay aligned with the repo's current release line.
 *
 * Usage:
 *   node scripts/sync-version.js
 *   npm run sync-version
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version in VERSION file: "${version}"`);
  process.exit(1);
}

function rel(filePath) {
  return filePath.replace(root + '/', '');
}

function syncJson(filePath, updater) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  updater(data);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ ${rel(filePath)} → ${version}`);
}

function syncTextPattern(relPath, pattern, replacement, description = relPath) {
  const filePath = join(root, relPath);
  const content = readFileSync(filePath, 'utf8');
  const updated = content.replace(pattern, replacement);
  if (updated === content) {
    throw new Error(`Could not update ${description}`);
  }
  writeFileSync(filePath, updated);
  console.log(`✓ ${description} → ${version}`);
}

// package.json
syncJson(join(root, 'package.json'), (pkg) => {
  pkg.version = version;
});

// package-lock.json
syncJson(join(root, 'package-lock.json'), (lockfile) => {
  lockfile.version = version;
  if (lockfile.packages && lockfile.packages['']) {
    lockfile.packages[''].version = version;
  }
});

// plugins/envcp/.claude-plugin/plugin.json
syncJson(join(root, 'plugins/envcp/.claude-plugin/plugin.json'), (plugin) => {
  plugin.version = version;
});

// .claude-plugin/marketplace.json
syncJson(join(root, '.claude-plugin/marketplace.json'), (mkt) => {
  mkt.version = version;
  if (Array.isArray(mkt.plugins)) {
    mkt.plugins = mkt.plugins.map((p) => ({ ...p, version }));
  }
});

// crates/envcp-node/package.json
syncJson(join(root, 'crates/envcp-node/package.json'), (pkg) => {
  pkg.version = version;
});

// server.json
syncJson(join(root, 'server.json'), (server) => {
  server.version = version;
  if (Array.isArray(server.packages)) {
    server.packages = server.packages.map((pkg) => ({ ...pkg, version }));
  }
});

// Cargo.toml files — replace the first `version = "..."` line only (package version)
function syncCargoToml(relPath) {
  const p = join(root, relPath);
  const content = readFileSync(p, 'utf8');
  const updated = content.replace(/^version = ".*"/m, `version = "${version}"`);
  writeFileSync(p, updated);
  console.log(`✓ ${relPath} → ${version}`);
}

syncCargoToml('crates/envcp-core/Cargo.toml');
syncCargoToml('crates/envcp-node/Cargo.toml');
syncCargoToml('crates/envcp-python/Cargo.toml');

// Python metadata
syncTextPattern(
  'crates/envcp-python/pyproject.toml',
  /^version = ".*"$/m,
  `version = "${version}"`,
);
syncTextPattern(
  'python/pyproject.toml',
  /^version = ".*"$/m,
  `version = "${version}"`,
);
syncTextPattern(
  'python/envcp/__init__.py',
  /^__version__ = ".*"$/m,
  `__version__ = "${version}"`,
);

// Other release metadata
syncTextPattern(
  'cloudflare/wrangler.toml',
  /^VERSION = ".*"$/m,
  `VERSION = "${version}"`,
);
syncTextPattern(
  'CITATION.cff',
  /^version: ".*"$/m,
  `version: "${version}"`,
);

console.log(`\nVersion synced: ${version}`);
