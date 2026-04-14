#!/usr/bin/env node
/**
 * EnvCP MCP server wrapper.
 *
 * Starts `envcp serve --mode mcp` only when EnvCP is installed and the vault
 * has been initialized. Exits 0 silently otherwise so Claude Code does not
 * show a startup error. Run /envcp:setup to initialize the vault.
 */

'use strict';

const { execFileSync, spawn } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

// 1. Is envcp installed?
let envcpBin = 'envcp';
try {
  execFileSync(envcpBin, ['--version'], { stdio: 'ignore' });
} catch {
  // Try npx as fallback — will install on first use
  envcpBin = null;
}

if (!envcpBin) {
  process.stderr.write(
    '[envcp] EnvCP is not installed globally.\n' +
    '[envcp] Run: npm install -g @fentz26/envcp\n' +
    '[envcp] Then run /envcp:setup to initialize your vault.\n'
  );
  process.exit(0);
}

// 2. Is a vault initialized in the current project or globally?
const cwd = process.cwd();
const projectVault = join(cwd, '.envcp');
const globalVault = join(
  process.env.HOME || process.env.USERPROFILE || cwd,
  '.envcp'
);

if (!existsSync(projectVault) && !existsSync(globalVault)) {
  process.stderr.write(
    '[envcp] No vault found. Run /envcp:setup to initialize one.\n'
  );
  process.exit(0);
}

// 3. Start the MCP server
const proc = spawn(envcpBin, ['serve', '--mode', 'mcp'], {
  stdio: 'inherit',
  cwd,
});

proc.on('error', (err) => {
  process.stderr.write(`[envcp] Failed to start MCP server: ${err.message}\n`);
  process.exit(0);
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});
