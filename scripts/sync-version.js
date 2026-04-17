#!/usr/bin/env node
/**
 * sync-version.js
 *
 * Reads VERSION from the repo root and propagates it to:
 *   - package.json
 *   - plugins/envcp/.claude-plugin/plugin.json
 *   - .claude-plugin/marketplace.json
 *   - crates/envcp-core/Cargo.toml
 *   - crates/envcp-node/Cargo.toml
 *   - crates/envcp-node/package.json
 *   - crates/envcp-python/Cargo.toml
 *   - crates/envcp-python/pyproject.toml
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

// crates/envcp-node/package.json
syncJson(join(root, 'crates/envcp-node/package.json'), (pkg) => {
  pkg.version = version;
});

// crates/envcp-python/pyproject.toml — sync [project].version
const pyprojectPath = join(root, 'crates/envcp-python/pyproject.toml');
const pyprojectContent = readFileSync(pyprojectPath, 'utf8');
const updatedPyproject = pyprojectContent.replace(
  /^version = ".*"/m,
  `version = "${version}"`,
);
writeFileSync(pyprojectPath, updatedPyproject);
console.log(`✓ crates/envcp-python/pyproject.toml → ${version}`);

console.log(`\nVersion synced: ${version}`);
console.log('Run `npm install` to update package-lock.json.');
