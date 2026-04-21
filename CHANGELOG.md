# Changelog

All notable changes to EnvCP are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/).

---

## [1.2.0] - 2026-04-18

### Added

- Interactive setup and menus for `envcp`, `envcp config`, and `envcp rule`
- Variable-specific AI rules with optional time windows
- Client-specific AI rules (`client_rules`) for clients like `mcp`, `openai`, `gemini`, and `api`
- Scoped rule storage for project, home, and merged views
- Auto-start service setup for Linux, macOS, and Windows
- Brute-force protection with progressive delays and permanent lockout handling
- Config file integrity checks using HMAC signatures
- Python package updates and Rust core groundwork via `envcp-core`
- Release channels for latest, experimental, and canary builds

### Changed

- Simplified first-run project setup with Basic / Advanced / Manual flows
- `envcp init` now guides first-time setup and points existing projects to `envcp setup`
- `envcp setup` now handles project reconfiguration
- Vault management now uses `envcp vault use` and `envcp vault contexts` instead of old top-level aliases
- CLI docs, wiki pages, and setup guides were aligned with the current command surface
- Rule listing now shows readable output, scope origin, and who-specific labels

### Fixed

- Backup restore no longer silently overwrites a corrupted primary store
- API key checks now cover all AI access flags, not only execute access
- Non-TTY prompt handling is more reliable for tests and scripted input
- Prompt-related test cleanup removed the remaining Jest open-handle warning
- Windows script generation and related injection edge cases were tightened
- Build, lint, and test verification were cleaned up for release readiness

### Security

- Updated crypto and threat-model documentation
- Release verification and signed publish flow remain documented in `VERIFICATION.md`

### Documentation

- Updated README, setup docs, command reference, configuration reference, and wiki mirrors
- Added rule system documentation for `envcp rule`, `access.variable_rules`, and `access.client_rules`
- Cleaned outdated command examples from docs and setup guides

### Tests

- Added focused tests for rules, vault CLI flows, prompt handling, config loading, and access control
- Release verification finished with full build, lint, and test passes before tagging

### Dependencies

- actions/checkout v4 → v6
- actions/setup-node v5 → v6
- actions/setup-python v5 → v6
- actions/upload-artifact v4 → v7
- actions/download-artifact v4 → v8
- docker/setup-buildx-action v3 → v4

---

## [1.1.0] - 2026-04-11

### Added

- **Global Vault with Switch Command** ([#124](https://github.com/fentz26/EnvCP/issues/124))
  - New `vault` configuration section with `default` (project/global) and `global_path` settings
  - Global vault stored at `~/.envcp/store.enc` for sharing secrets across all projects
  - Named vaults support for managing multiple secret contexts
  - CLI commands for vault management:
    - `envcp vault --global init|add|list|get|delete` — operate on global vault
    - `envcp vault --project init|add|list|get|delete` — operate on project vault
    - `envcp vault --name <name> init|add|list|get|delete` — manage named vaults
    - `envcp vault-switch <name>` — switch active vault context
    - `envcp vault-list` — list all available vaults
  - ConfigGuard now watches global vault store for tampering
  - Server-side vault path resolution for all adapters

- **Per-Variable Password Protection** ([#125](https://github.com/fentz26/EnvCP/issues/125))
  - Optional additional password layer for individual variables using Argon2id + AES-256-GCM
  - New Variable schema fields: `protected`, `password_hash`, `protected_value`
  - New configuration option: `access.require_variable_password`
  - Tool parameter updates:
    - `envcp_get`: `variable_password` parameter required for protected variables
    - `envcp_set`: `protect`, `unprotect`, `variable_password` parameters for protection management
    - `envcp_list`: Returns `{name, protected}` objects when any protected variable exists
  - Wrong password attempts are logged for audit trail

- **Test Coverage Improvements** ([#123](https://github.com/fentz26/EnvCP/issues/123))
  - Achieved 100% line coverage (493 tests, 99.93% lines)
  - Added 5 new test files for previously uncovered code paths:
    - `lock.test.ts` — file lock retry logic
    - `base-timeout.test.ts` — runCommand timeout kill paths
    - `mcp-start.test.ts` — MCP stdio transport startup
    - `unified-extra.test.ts` — MCP mode, SIGTERM handler, Gemini routes
    - `update-checker-fetch.test.ts` — HTTPS error path mocking
  - Fixed config-manager test isolation for CI environments

- **Documentation**
  - Updated README with vault commands and per-variable protection
  - Updated wiki with new features and SAL v1.0 license
  - Added SonarCloud configuration for proper TypeScript analysis

### Changed

- **StorageManager** — Made `encrypted` property public for CLI access
- **SonarCloud** — Added `sonar-project.properties` for TypeScript language detection

### Fixed

- **Config Manager Test Isolation** — Tests now properly isolate HOME environment
- **SonarCloud Python Warning** — Fixed false positive language detection

### Security

- ConfigGuard now monitors global vault store file integrity
- Per-variable protection uses Argon2id (64 MB memory, 3 passes) for password hashing
- Protected values encrypted with AES-256-GCM using password-derived keys

---

## [1.0.92] - 2026-04-10

### Added

- **Configurable Rate Limiting** ([#113](https://github.com/fentz26/EnvCP/issues/113), [#114](https://github.com/fentz26/EnvCP/pull/114))
  - New `server.rate_limit` configuration block in `envcp.yaml`:
    - `enabled`: Enable/disable rate limiting (default: `true`)
    - `requests_per_minute`: Max requests per IP per minute (default: `60`)
    - `whitelist`: Array of IPs exempt from rate limiting (default: `[]`)
  - Rate limiting now applies to all HTTP modes: REST, OpenAI, Gemini, and unified server
  - IPv6-mapped IPv4 addresses properly normalized (e.g., `::ffff:127.0.0.1` → `127.0.0.1`)
  - Example configuration:
    ```yaml
    server:
      rate_limit:
        enabled: true
        requests_per_minute: 100
        whitelist: ["127.0.0.1", "::1"]
    ```

- **Augment Code / Auggie CLI Integration**
  - Added integration guide for Augment Code AI platform
  - Two setup methods:
    - CLI: `auggie mcp add-json envcp '{"type":"stdio","command":"npx","args":["-y","@fentz26/envcp","serve","--mode","mcp"]}'`
    - Settings: Import JSON config in VS Code/JetBrains MCP section

### Changed

- **Server Configuration Schema**
  - Added `server` section to `EnvCPConfigSchema` for YAML-based server configuration
  - `ServerModeSchema` and `RateLimitConfigSchema` moved before `EnvCPConfigSchema` for proper declaration order
  - CLI `serve` command now reads `server.rate_limit` from `envcp.yaml`

### Fixed

- **Memory Leak in Rate Limiter** ([#114](https://github.com/fentz26/EnvCP/pull/114))
  - `RateLimiter.destroy()` now called before reassignment in all adapters
  - Prevents orphaned cleanup intervals on server restart

- **Wasted Rate Limiter Allocation** ([#114](https://github.com/fentz26/EnvCP/pull/114))
  - Rate limiter initialization moved after single-mode early returns in `unified.ts`
  - Eliminates unnecessary allocation when using REST/OpenAI/Gemini single modes

- **IPv6 Whitelist Bypass** ([#114](https://github.com/fentz26/EnvCP/pull/114))
  - Whitelist check now normalizes IPv6-mapped IPv4 addresses
  - `127.0.0.1` whitelist entry now correctly matches `::ffff:127.0.0.1`

- **server.json Formatting**
  - Fixed indentation inconsistency in MCP Registry metadata file

### Security

- Rate limiting now configurable per deployment instead of hardcoded
- Whitelist allows trusted IPs (e.g., localhost) to bypass limits for internal services
- IPv6 normalization prevents bypass failures on dual-stack systems

---

## [1.0.91] - 2026-04-10

### Changed

- Version bump to proper semver format (was `1.0.9a`, now `1.0.91`)

---

## [1.0.9] - 2026-04-10

### Added

- **OS Keychain Integration** ([#108](https://github.com/fentz26/EnvCP/issues/108))  
  Store your master password in the OS-protected credential store for auto-unlock with biometric gating.
  - macOS: Keychain Access (Touch ID)
  - Linux: GNOME Keyring / libsecret (fingerprint)
  - Windows: Credential Manager (Windows Hello)
  - New commands: `envcp keychain status`, `envcp keychain save`, `envcp keychain remove`, `envcp keychain disable`
  - New flag: `envcp unlock --save-to-keychain`
  - Config: `keychain: { enabled: false, service: 'envcp' }` in `envcp.yaml`
  - Project-scoped accounts — different passwords per project directory
  - Security model unchanged: keychain stores the master password, Argon2id still derives the AES-256-GCM key

- **Weak password blocklist**  
  ~35 most common breached passwords (`password`, `12345678`, `qwerty123`, `trustno1`, etc.) are always rejected regardless of policy settings. Case-insensitive matching.

- **Password strength warnings**  
  CLI now warns (but allows) passwords under 12 characters or those using only a single character class. Warnings appear at all password entry points (`unlock`, `withSession`, `serve`).

- **Multilingual README**  
  Added translated READMEs: French, Spanish, Korean, Chinese, Vietnamese, Japanese.

### Changed

- **Hardened default password policy**  
  | Setting | Before | After |
  |---------|--------|-------|
  | `min_length` | 1 | **8** |
  | `allow_single_char` | true | **false** |
  | `allow_numeric_only` | true | **false** |
  
  Existing projects with `envcp.yaml` overrides are not affected. With Argon2id at 64MB/3 passes, the old `min_length: 1` allowed passwords crackable in under 10 seconds.

- **Renamed `envcp-python/` to `python/`** for cleaner project structure.

### Fixed

- **TOCTOU race conditions** ([#101](https://github.com/fentz26/EnvCP/issues/101))  
  Eliminated time-of-check-time-of-use races across the codebase:
  - `storage/index.ts`: Replaced `pathExists` + `readFile` chains with single `try/catch ENOENT` blocks in `load()`, `save()`, `rotateBackups()`, `tryRestoreFromBackup()`, and `verify()`
  - `session.ts`: Same atomic pattern for `create()`, `load()`, `extend()`, `destroy()`
  - All file operations now use atomic try/catch instead of check-then-act

- **API key logging** ([#102](https://github.com/fentz26/EnvCP/issues/102))  
  `envcp serve` no longer leaks the first 4 characters of the API key. Now displays `****...` (fully masked).

- **Version mismatch** ([#103](https://github.com/fentz26/EnvCP/issues/103))  
  `server.json` version and packages array now match `package.json`.

- **Docker Hub username hardcoded** ([#105](https://github.com/fentz26/EnvCP/issues/105))  
  Publish workflow now uses `${{ vars.DOCKERHUB_USERNAME }}` repo variable instead of hardcoded username.

### Security

- Password policy defaults hardened (see Changed section above)
- Weak password blocklist added (see Added section above)
- All 6 security audit findings from [#101](https://github.com/fentz26/EnvCP/issues/101)-[#106](https://github.com/fentz26/EnvCP/issues/106) resolved

### Tests

- **Coverage: 31% -> 98.4%** ([#107](https://github.com/fentz26/EnvCP/issues/107))
  - 12 tests -> **332 tests** across **16 suites**
  - 98.33% line coverage, 97% statement coverage
  - Coverage threshold raised from 26% to **95%** in CI
  - New test suites: `base-adapter`, `adapters` (REST/OpenAI/Gemini HTTP integration), `unified-server`, `config-manager`, `storage-advanced`, `mcp-server`, `crypto-recovery`, `http-server`, `keychain`
  - Remaining ~18 uncovered lines are dead code, process signals, ESM mock limitations, or 30s timeout paths

---

## [1.0.8] - 2026-04-09

### Added

- **MCP Registry metadata** ([#97](https://github.com/fentz26/EnvCP/issues/97))  
  Added `server.json` and `mcpName` field for MCP Registry publishing. DNS-based auth with custom domain `dev.fentz.envcp`.

- **Python wrapper package** ([#99](https://github.com/fentz26/EnvCP/issues/99))  
  `pip install envcp` now works — Python wrapper auto-installs Node.js package via npm.

- **Docker Hub and GHCR publishing**  
  Release workflow now builds and pushes Docker images to both Docker Hub and GitHub Container Registry.

- **Download badges** in README (npm total downloads).

### Fixed

- PyPI `packages-dir` path corrected in publish workflow.
- Docker image now runs `npm run build` before building to ensure `dist/` exists.
- npm and PyPI publishing merged into single workflow to avoid race conditions.
- Added `homepage` and `bugs` URL to `package.json` metadata.

---

## [1.0.7] - 2026-04-08

### Added

- **Welcome screen** on first CLI run with vault location info and quick-start guide.
- **Curl one-line installer**: `curl -fsSL https://envcp.org/install.sh | bash`
- **Mintlify documentation site** with wiki sync CD pipeline.
- **`envcp vault rename`** command to rename the current project vault.
- **Coverage reporting** in CI with configurable threshold.
- **Cloudflare Worker** for docs proxy and API routes at `envcp.org`.
- `ASSISTANT.md` for Mintlify documentation context.

### Fixed

- CLI `sync` now respects blacklist, access policies, and `sync_to_env` flag.
- Removed non-existent `config set` command from welcome screens.
- Unescape backslash-quoted chars in double-quoted `.env` values.
- CLI `get` and `list` commands now respect `mask_values` config.
- Removed unused `algorithm` and `compression` config options.
- Added `isolatedModules` to TypeScript config.
- Removed unused password hash and salt from session data.
- Corrected Cursor deeplink (npx, URL-encoded) and replaced MIT with SAL license.

---

## [1.0.6] - 2026-04-08

### Added

- **Security headers** on all HTTP responses (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Cache-Control: no-store`).
- **Dependabot** configuration for automated security updates.
- **CodeQL** security scanning workflow.
- Comprehensive **wiki documentation** for API, integrations, and session management.

### Fixed

- CodeQL security alerts resolved.
- `fs-extra` ESM import issue fixed.
- `syncToEnv` target path hardened against traversal.
- `envcp_run` now enforces variable access policy.

### Dependencies

- `dotenv` 16.6.1 -> 17.4.1
- `actions/checkout` v4 -> v6
- `actions/setup-node` v4 -> v6
- `github/codeql-action` v3 -> v4

---

## [1.0.5] - 2026-04-08

### Added

- **Dry-run mode** for testing operations without writing.
- **Secret isolation** fix — variables properly scoped.
- **`envcp doctor`** command for diagnostics and health checks.
- **CI workflow** for automated testing and building.
- `CONTRIBUTING.md` and `SECURITY.md`.

---

## [1.0.4] - 2026-04-08

### Added

- **Simplified setup** — streamlined `envcp init` flow.
- **Passwordless mode** — run without encryption for dev/testing.
- **Universal IDE support** — auto-registers MCP config for VS Code, Cursor, JetBrains, Zed, Continue.dev, OpenCode, GitHub Copilot CLI, Google AntiGravity.

---

## [1.0.3] - 2026-04-08

### Added

- **Auto `.env` import** during `envcp init` — reads existing `.env` and imports variables.
- **MCP auto-registration** during init for detected IDE tools.
- **Atomic writes** for store file to prevent corruption on crash.
- **Automatic backup rotation** on every write with auto-restore from backup on corruption.
- **`envcp backup`** and **`envcp restore`** commands for manual backup management.
- **Password recovery mode** — choose `hard-lock` (no recovery) or `recoverable` (recovery key shown once).
- **`envcp verify`** command for store integrity verification.
- **`envcp export --encrypted`** and **`envcp import`** for portable encrypted migration.

---

## [1.0.2] - 2026-04-08

### Changed

- README reorganized — simple usage on top, advanced on bottom.

### Fixed

- Package name corrected to `@fentz26/envcp` in README.

---

## [1.0.1] - 2026-04-08

Initial public release.

### Security (shipped in v1.0.1)

- **Command injection** — `envcp_run` now rejects shell metacharacters (`;`, `|`, `&`, `` ` ``, `$()`, etc.) and validates against an allowlist.
- **Regex injection** — `matchesPattern` escapes special regex characters before matching.
- **Variable name validation** — `set` handlers reject names that don't match `^[A-Za-z_][A-Za-z0-9_]*$`.
- **Path traversal** — `envcp_add_to_env` rejects `env_file` paths outside the project directory.
- **Information leakage** — `checkAccess` no longer reveals whether a variable exists or is blacklisted.
- **`.env` quoting** — Values with spaces/special characters are properly double-quoted.
- **CORS** — Only accepts `localhost`, `127.0.0.1`, and `[::1]` origins.
- **Command gating** — `envcp_run` requires `allow_ai_execute: true` and an explicit `allowed_commands` list.
- **Session security** — Plaintext password removed from session file; uses verification hash instead.
- **Rate limiting** — 60 requests/minute per IP on all HTTP endpoints.
- **Deprecated API cleanup** — Replaced `url.parse` with `new URL()`.
- **Type safety** — Replaced all `as any` casts and `error: any` catches with proper types.
- **Code deduplication** — Extracted `BaseAdapter` and `registerDefaultTools`, eliminating ~670 lines of duplication.
- **Symlink attacks** — `lstat` checks reject symlinks at store and session paths.
- **Concurrent writes** — `proper-lockfile` for storage and session write safety.
- **Encryption versioning** — `v2:` prefix for Argon2id data, `v1:` for legacy PBKDF2 (backward-compatible decryption).

### Core

- AES-256-GCM encryption with Argon2id key derivation (64MB memory, 3 passes)
- MCP server (stdio) for AI tool integration
- REST, OpenAI, and Gemini HTTP adapter modes
- Unified server with auto-detection of client type
- Variable management: add, get, list, delete, sync, export, import
- Session management with timeout and extension limits
- Configurable access control: per-operation AI permissions, blacklist patterns, confirmation requirements
- Audit logging of all operations

---

[1.0.92]: https://github.com/fentz26/EnvCP/compare/v1.0.91...v1.0.92
[1.0.91]: https://github.com/fentz26/EnvCP/compare/v1.0.9...v1.0.91
[1.0.9]: https://github.com/fentz26/EnvCP/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/fentz26/EnvCP/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/fentz26/EnvCP/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/fentz26/EnvCP/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/fentz26/EnvCP/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/fentz26/EnvCP/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/fentz26/EnvCP/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/fentz26/EnvCP/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/fentz26/EnvCP/releases/tag/v1.0.1
