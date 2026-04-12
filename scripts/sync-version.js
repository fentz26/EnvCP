#!/usr/bin/env node
/**
 * sync-version.js
 *
 * Reads VERSION from the repo root and propagates it to:
 *   - package.json
 *   - plugins/envcp/.claude-plugin/plugin.json
 *   - .claude-plugin/marketplace.json
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

function syncJson(filePath, updater) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  updater(data);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ ${filePath.replace(root + '/', '')} → ${version}`);
}

// package.json
syncJson(join(root, 'package.json'), (pkg) => {
  pkg.version = version;
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

console.log(`\nVersion synced: ${version}`);
console.log('Run `npm install` to update package-lock.json.');
