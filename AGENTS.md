# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

EnvCP is a CLI tool and server for secure environment variable management for AI-assisted coding. It is a single-package Node.js/TypeScript project (not a monorepo) with zero external service dependencies.

### Build, test, and run

Standard commands are documented in `package.json` scripts and `CONTRIBUTING.md`:

- **Install:** `npm install`
- **Build (also serves as type-check/lint):** `npm run build` (runs `tsc`)
- **Test:** `npm test` (Jest, 36 tests across 4 suites)
- **CLI:** `node dist/cli.js --help`
- **Server:** `node dist/cli.js serve --mode rest --port 3456 --password <pw>`

### Known issue: `fs-extra` ESM compatibility

The codebase uses `import * as fs from 'fs-extra'` which does not expose `readFile`, `writeFile`, or `appendFile` as named exports in ESM mode (Node 18+). This causes runtime `TypeError: fs.readFile is not a function` errors in several CLI commands (`init`, `add`, `unlock`) and when loading config files. The **tests pass** because `ts-jest` transforms imports differently. The `serve` command works if no `envcp.yaml` or `~/.envcp/config.yaml` files exist (defaults are used), but variable operations fail at the session layer for the same reason.

### Gotchas

- The `init` command is interactive (uses `inquirer` prompts). Use `--no-encrypt --skip-env --skip-mcp` flags to skip all prompts.
- The `serve` command also prompts for a password unless `--password <pw>` is provided or `encryption.enabled` is `false` in config.
- There is no dedicated lint command; `npm run build` (`tsc`) is the only static analysis step.
