# CLI Reference

Complete reference for all EnvCP command-line interface commands.

## Global Options

These options work with all commands:

```bash
envcp [command] [options]
```

- `--help, -h` - Show help
- `--version, -v` - Show version number
- `--config <path>` - Use custom config file (default: `envcp.yaml`)
- `--password, -p <password>` - Provide password inline (use carefully)

## Commands

### init

Initialize EnvCP in a project.

```bash
envcp init [options]
```

**Options**:
- `--project <name>` - Project name (default: directory name)
- `--password, -p <password>` - Set password inline
- `--force` - Overwrite existing configuration

**Examples**:

```bash
# Interactive mode (prompts for details)
envcp init

# With project name
envcp init --project my-awesome-app

# With password (careful: visible in shell history)
envcp init --password mysecret

# Force re-initialization
envcp init --force
```

**What it creates**:
- `.envcp/` directory
- `.envcp/store.enc` encrypted storage
- `.envcp/logs/` log directory
- `envcp.yaml` configuration file

---

### add

Add or update an environment variable.

```bash
envcp add <name> [options]
```

**Options**:
- `--value, -v <value>` - Variable value (prompts if not provided)
- `--description, -d <desc>` - Variable description
- `--password, -p <password>` - Unlock password

**Examples**:

```bash
# Interactive (prompts for value)
envcp add API_KEY

# With value inline
envcp add API_KEY --value "sk-1234567890"

# With description
envcp add API_KEY --value "sk-123" --description "OpenAI API key for dev"

# With password
envcp add API_KEY --value "sk-123" --password mysecret
```

**Notes**:
- Overwrites existing variables with the same name
- Value is encrypted immediately
- Session must be unlocked (or provide password)

---

### list

List all environment variables.

```bash
envcp list [options]
```

**Options**:
- `--show-values` - Show variable values (not just names)
- `--format <format>` - Output format: `table`, `json`, `yaml` (default: `table`)
- `--password, -p <password>` - Unlock password

**Examples**:

```bash
# List names only
envcp list

# Show values too
envcp list --show-values

# JSON format
envcp list --format json

# JSON with values
envcp list --show-values --format json

# YAML format
envcp list --show-values --format yaml
```

**Output**:

```bash
$ envcp list
╭────────────────┬──────────────────────────╮
│ Name           │ Description              │
├────────────────┼──────────────────────────┤
│ API_KEY        │ OpenAI API key           │
│ DATABASE_URL   │ Postgres connection      │
│ STRIPE_KEY     │ Stripe secret key        │
╰────────────────┴──────────────────────────╯
```

---

### get

Get a specific environment variable.

```bash
envcp get <name> [options]
```

**Options**:
- `--mask` - Mask the value (show only first/last chars)
- `--format <format>` - Output format: `value`, `json`, `yaml` (default: `value`)
- `--password, -p <password>` - Unlock password

**Examples**:

```bash
# Get value
envcp get API_KEY

# Masked value
envcp get API_KEY --mask

# JSON format
envcp get API_KEY --format json

# Just the value (for scripts)
API_KEY=$(envcp get API_KEY)
```

**Output**:

```bash
$ envcp get API_KEY
sk-1234567890abcdef

$ envcp get API_KEY --mask
sk-123...def (masked)
```

---

### remove

Remove an environment variable.

```bash
envcp remove <name> [options]
```

**Aliases**: `delete`, `rm`

**Options**:
- `--force, -f` - Skip confirmation prompt
- `--password, -p <password>` - Unlock password

**Examples**:

```bash
# With confirmation
envcp remove OLD_API_KEY

# Skip confirmation
envcp remove OLD_API_KEY --force

# Alias
envcp delete OLD_API_KEY
envcp rm OLD_API_KEY
```

**Output**:

```bash
$ envcp remove API_KEY
Are you sure you want to remove API_KEY? (y/N): y
Variable 'API_KEY' removed successfully
```

---

### sync

Sync variables to .env file.

```bash
envcp sync [options]
```

**Options**:
- `--target <file>` - Target file (default from config: `.env`)
- `--format <format>` - Format: `env`, `json`, `yaml` (default: `env`)
- `--no-backup` - Don't create backup
- `--password, -p <password>` - Unlock password

**Examples**:

```bash
# Sync to .env
envcp sync

# Sync to custom file
envcp sync --target .env.local

# JSON format
envcp sync --target config.json --format json

# No backup
envcp sync --no-backup
```

**Output**:

```bash
$ envcp sync
Synced 5 variables to .env
Backup created: .envcp/backups/.env.backup.20260408_123456
```

---

### run

Run a command with environment variables injected.

```bash
envcp run <command> [args...] [options]
```

**Options**:
- `--password, -p <password>` - Unlock password

**Examples**:

```bash
# Run npm script
envcp run npm test

# Run Node.js script
envcp run node server.js

# Run with arguments
envcp run node script.js --arg1 --arg2

# Docker compose
envcp run docker-compose up

# Custom command
envcp run ./my-script.sh
```

**How it works**:
1. Loads all variables from EnvCP
2. Injects them into process environment
3. Runs your command with those variables
4. Returns command output and exit code

---

### unlock

Unlock the vault for quick access.

```bash
envcp unlock [options]
```

**Options**:
- `--password, -p <password>` - Password (prompts if not provided)
- `--timeout <seconds>` - Session timeout in seconds (overrides config)

**Examples**:

```bash
# Interactive (prompts for password)
envcp unlock

# With password inline
envcp unlock --password mysecret

# Custom timeout (1 hour)
envcp unlock --timeout 3600
```

**Output**:

```bash
$ envcp unlock
Password: ****
Session unlocked for 30 minutes
```

---

### lock

Lock the vault immediately.

```bash
envcp lock
```

**Examples**:

```bash
# Lock immediately
envcp lock
```

**Output**:

```bash
$ envcp lock
Session locked
```

---

### status

Check session status.

```bash
envcp status [options]
```

**Options**:
- `--format <format>` - Format: `text`, `json` (default: `text`)

**Examples**:

```bash
# Human-readable
envcp status

# JSON format (for scripts)
envcp status --format json
```

**Output**:

```bash
$ envcp status
Session: Unlocked
Time remaining: 25 minutes 30 seconds
Auto-extend: Enabled

$ envcp status --format json
{
  "locked": false,
  "remaining": 1530,
  "expiresAt": "2026-04-08T14:30:00Z",
  "autoExtend": true
}
```

---

### extend

Extend the current session.

```bash
envcp extend [options]
```

**Options**:
- `--time <seconds>` - Extension time (default from config)

**Examples**:

```bash
# Extend by default amount (15 minutes)
envcp extend

# Extend by 1 hour
envcp extend --time 3600
```

**Output**:

```bash
$ envcp extend
Session extended by 15 minutes
New expiry: 14:30:00
```

---

### serve

Start EnvCP server.

```bash
envcp serve [options]
```

**Options**:
- `--mode, -m <mode>` - Server mode: `mcp`, `rest`, `openai`, `gemini`, `all`, `auto`
- `--port <port>` - HTTP port (default: 3456, not used for MCP)
- `--host <host>` - HTTP host (default: 127.0.0.1)
- `--api-key, -k <key>` - API key for authentication
- `--password, -p <password>` - Unlock password

**Server Modes**:
- `mcp` - MCP protocol over stdio (for Claude Desktop, Cursor)
- `rest` - REST API over HTTP
- `openai` - OpenAI function calling format
- `gemini` - Google/Gemini function calling format
- `all` - All HTTP protocols on same port
- `auto` - Auto-detect client from request headers

**Examples**:

```bash
# MCP mode (stdio)
envcp serve --mode mcp

# REST API
envcp serve --mode rest --port 3456 --api-key secret123

# OpenAI format
envcp serve --mode openai --port 3456 --api-key secret123

# Auto-detect mode
envcp serve --mode auto --port 3456 --api-key secret123

# All protocols
envcp serve --mode all --port 3456 --api-key secret123

# Custom host (allow network access)
envcp serve --mode rest --host 0.0.0.0 --port 3456

# With auto-unlock
envcp serve --mode rest --password mysecret --api-key secret123
```

**Output**:

```bash
$ envcp serve --mode rest --port 3456
EnvCP server started
Mode: REST API
Address: http://127.0.0.1:3456
Press Ctrl+C to stop
```

---

### export

Export variables to stdout or file.

```bash
envcp export [options]
```

**Options**:
- `--format, -f <format>` - Format: `env`, `json`, `yaml` (default: `env`)
- `--output, -o <file>` - Output file (default: stdout)
- `--encrypted` - Create an encrypted portable export file (requires `--output`)
- `--password, -p <password>` - Unlock password

**Examples**:

```bash
# Export to stdout (.env format)
envcp export

# Save to file
envcp export --output backup.env

# JSON format
envcp export --format json

# Encrypted portable export (prompts for export password)
envcp export --encrypted --output backup.enc

# YAML format
envcp export --format yaml > config.yaml
```

**Encrypted export**: creates a file encrypted with a separate password. Share securely between machines or projects and import with `envcp import`.

---

### import

Import variables from an encrypted export file.

```bash
envcp import <file> [options]
```

**Options**:
- `--merge` - Merge with existing variables (default: replace all)
- `--dry-run` - Preview what would change without writing

**Examples**:

```bash
# Replace store with imported variables (prompts for export password)
envcp import backup.enc

# Merge into existing store
envcp import backup.enc --merge

# Preview changes first
envcp import backup.enc --dry-run
```

**Output**:

```bash
$ envcp import backup.enc --dry-run
Import info:
  From project: my-project
  Exported: 2026-04-10T12:00:00Z
  Variables: 5

Dry run: import (replace)
  + API_KEY = sk-1****890
  + DATABASE_URL = post****url
  ~ STRIPE_KEY = sk_****123 (changed)

No files were modified.
```

---

### backup

Create an encrypted backup of all variables using your vault password.

```bash
envcp backup [options]
```

**Options**:
- `--output, -o <path>` - Output file path (default: `.envcp/backup-<timestamp>.enc`)

**Examples**:

```bash
# Default path (.envcp/backup-<timestamp>.enc)
envcp backup

# Custom path
envcp backup --output ~/secure/my-project.enc
```

**Output**:

```bash
$ envcp backup
Backup created: .envcp/backup-2026-04-10T12-00-00.enc
  Variables: 5
  Encrypted: yes
```

Unlike `export --encrypted`, backups use your existing vault password rather than a separate export password.

---

### restore

Restore variables from an encrypted backup.

```bash
envcp restore <file> [options]
```

**Options**:
- `--merge` - Merge with existing variables (default: replace all)

**Examples**:

```bash
# Replace current store with backup
envcp restore .envcp/backup-2026-04-10T12-00-00.enc

# Merge backup into current store
envcp restore .envcp/backup-2026-04-10T12-00-00.enc --merge
```

---

### recover

Recover vault access using your recovery key (reset password).

```bash
envcp recover
```

Only available in `recoverable` security mode. Not available in `hard-lock` mode.

**Interactive flow**:
1. Prompts for recovery key (shown once during `init`)
2. Verifies key and decrypts store
3. Prompts for new password
4. Re-encrypts store and generates a new recovery key

**Output**:

```bash
$ envcp recover
Enter your recovery key: ****
Recovery key verified. Store contains 5 variables.
Set new password: ****
Confirm new password: ****
Password reset successfully!

NEW RECOVERY KEY (save this somewhere safe!):
  a1b2c3d4e5f6...
Your old recovery key no longer works.
Session unlocked with new password.
```

---

### verify

Verify store integrity and check backup status.

```bash
envcp verify
```

**Output**:

```bash
$ envcp verify
Store integrity: OK
  Variables: 5
  Backups: 2
  Recovery: available
```

---

### doctor

Diagnose common issues and check system health.

```bash
envcp doctor
```

Checks performed:
- Config file loadable
- Encryption enabled/disabled
- Security mode
- Store file exists
- Session status
- Recovery file present (recoverable mode)
- `.envcp/` directory exists
- `.gitignore` includes `.envcp/`
- MCP registration status

**Output**:

```bash
$ envcp doctor

EnvCP Doctor

  [PASS] Config: Loaded (project: my-project)
  [PASS] Encryption: Enabled (AES-256-GCM)
  [PASS] Security mode: recoverable
  [PASS] Store file: Exists (4096 bytes)
  [WARN] Session: No active session — run `envcp unlock`
  [PASS] Recovery file: Present
  [PASS] .envcp directory: Exists
  [WARN] .gitignore: .envcp/ not in .gitignore — secrets may be committed
  [PASS] MCP registration: 1 tool(s) configured

All checks passed with 2 warning(s).
```

---

### update

Check for EnvCP updates.

```bash
envcp update [options]
```

**Options**:
- `--check` - Check for available updates (default when no options provided)

**Examples**:

```bash
envcp update
envcp update --check
```

**Output**:

```bash
$ envcp update
Checking for updates...
You are running the latest version of EnvCP (v1.2.0)
```

---

### vault

Manage project, global, or named vaults.

```bash
envcp vault [--global | --project | --name <name>] <subcommand>
```

**Flags**:
- `--global` - Operate on the global vault (`~/.envcp/store.enc`)
- `--project` - Operate on the project vault (default)
- `--name <name>` - Operate on a named vault

**Subcommands**:

#### vault init

Initialize a vault.

```bash
envcp vault init
envcp vault --global init
envcp vault --name staging init
```

#### vault add

Add a variable to a vault.

```bash
envcp vault add <name> [options]
envcp vault --global add <name> [options]
```

**Options**: `--value, -v`, `--tags, -t`

#### vault list

List variables in a vault.

```bash
envcp vault list
envcp vault --global list
envcp vault --global list --show-values
```

#### vault get

Get a variable from a vault.

```bash
envcp vault get <name>
envcp vault --global get <name> --show-value
```

#### vault delete

Delete a variable from a vault.

```bash
envcp vault delete <name>
envcp vault --global delete <name>
```

---

### vault-switch

Switch the active vault context for subsequent commands.

```bash
envcp vault-switch <name>
```

**Arguments**:
- `<name>` - `global`, `project`, or a named vault created with `envcp vault --name <name> init`

**Examples**:

```bash
# Switch to global vault
envcp vault-switch global

# Switch back to project vault
envcp vault-switch project

# Switch to a named vault
envcp vault-switch staging
```

**Output**:

```bash
$ envcp vault-switch global
Switched to vault: global
```

After switching, commands like `envcp list`, `envcp get`, `envcp add` operate on the active vault.

---

### vault-list

List all available vaults and their status.

```bash
envcp vault-list
```

**Output**:

```bash
$ envcp vault-list
Available vaults:
  global (active)
    /home/user/.envcp/store.enc
  project
    /home/user/my-project/.envcp/store.enc
  staging [not initialized]
    /home/user/my-project/.envcp/vaults/staging/store.enc
```

---

### keychain

Manage OS keychain integration for auto-unlock.

```bash
envcp keychain <subcommand>
```

**Subcommands**:

#### keychain status

Check keychain availability and stored credentials.

```bash
envcp keychain status
```

**Output**:

```bash
$ envcp keychain status
Keychain Status
  Backend:    libsecret
  Available:  yes
  Stored:     yes
  Enabled:    yes
```

#### keychain save

Save the current session password to the OS keychain. Enables auto-unlock on future sessions.

```bash
envcp keychain save
```

Equivalent to running `envcp unlock --save-to-keychain`.

#### keychain remove

Remove the stored password from the OS keychain.

```bash
envcp keychain remove
```

Also disables keychain auto-unlock in config.

#### keychain disable

Disable keychain auto-unlock without removing the stored credential.

```bash
envcp keychain disable
```

---
### service

Install EnvCP as a system service for always-on availability.

```bash
envcp service <subcommand>
```

**Subcommands**:

#### service install

Install EnvCP as a system service (systemd on Linux, launchd on macOS, Scheduled Task on Windows).

```bash
envcp service install [options]
```

**Options**:
- `--user` - Install as user service (systemd: `--user`, launchd: user agent)
- `--name <name>` - Service name (default: `envcp`)
- `--config <path>` - Path to `envcp.yaml` config file (default: current directory)

**Examples**:
```bash
# Install as system service
envcp service install

# Install as user service (Linux/macOS)
envcp service install --user

# Custom service name
envcp service install --name envcp-myproject
```

#### service start

Start the installed service.

```bash
envcp service start [options]
```

**Options**:
- `--name <name>` - Service name (default: `envcp`)

#### service stop

Stop the running service.

```bash
envcp service stop [options]
```

**Options**:
- `--name <name>` - Service name (default: `envcp`)

#### service status

Check service status.

```bash
envcp service status [options]
```

**Options**:
- `--name <name>` - Service name (default: `envcp`)

#### service logs

View service logs (last 100 lines).

```bash
envcp service logs [options]
```

**Options**:
- `--name <name>` - Service name (default: `envcp`)
- `--follow, -f` - Follow log output (like `tail -f`)
- `--lines, -n <number>` - Number of lines to show (default: 100)

#### service uninstall

Uninstall the service.

```bash
envcp service uninstall [options]
```

**Options**:
- `--name <name>` - Service name (default: `envcp`)

**Platform Support**:
- **Linux**: systemd (user or system)
- **macOS**: launchd (user agent or daemon)
- **Windows**: Scheduled Task (user or system)

**Service Configuration**: Stored in `~/.envcp/service.yaml` after installation.


---

### config reload

Reload the configuration from `envcp.yaml` (requires password to confirm).

```bash
envcp config reload
```

Use this after manually editing `envcp.yaml` to apply changes while a session is active.

**Output**:

```bash
$ envcp config reload
Enter password to reload config: ****
Config reloaded successfully
  New config hash: a1b2c3d4e5f6...
```

---

## Advanced Usage

### Scripting

Use EnvCP in shell scripts:

```bash
#!/bin/bash

# Get a variable
API_KEY=$(envcp get API_KEY --password mysecret)

# Export all variables
envcp export --format env > .env

# Run command with env vars
envcp run --password mysecret npm test

# Check if unlocked
if envcp status --format json | jq -r .locked | grep -q false; then
  echo "Unlocked"
else
  echo "Locked"
fi
```

### CI/CD Integration

```bash
# In CI pipeline
envcp init --password $ENVCP_PASSWORD --force
envcp add API_KEY --value $API_KEY --password $ENVCP_PASSWORD
envcp run npm test
```

### Multiple Projects

```bash
# Project A
cd /path/to/project-a
envcp --config envcp.yaml serve --mode mcp

# Project B
cd /path/to/project-b
envcp --config envcp.prod.yaml serve --mode mcp
```

### Custom Configuration

```bash
# Use different config files
envcp --config envcp.dev.yaml list
envcp --config envcp.prod.yaml serve --mode rest
```

## Exit Codes

EnvCP uses standard exit codes:

- `0` - Success
- `1` - General error
- `2` - Invalid arguments
- `3` - Authentication error (wrong password)
- `4` - Session locked
- `5` - Variable not found
- `6` - Permission denied

**Example**:

```bash
#!/bin/bash
envcp get API_KEY
if [ $? -eq 0 ]; then
  echo "Success"
else
  echo "Failed"
fi
```

## Environment Variables

EnvCP respects these environment variables:

- `ENVCP_PASSWORD` - Default password (use carefully)
- `ENVCP_CONFIG` - Config file path
- `NO_COLOR` - Disable colored output

**Example**:

```bash
# Set password via env var
export ENVCP_PASSWORD=mysecret
envcp list  # No password prompt

# Custom config
export ENVCP_CONFIG=/path/to/envcp.yaml
envcp list

# Disable colors
export NO_COLOR=1
envcp list
```

## Next Steps

- [Configuration Reference](Configuration-Reference) - All config options
- [MCP Integration](MCP-Integration) - Set up with Claude/Cursor
- [Security Best Practices](Security-Best-Practices) - Secure your setup
- [Troubleshooting](Troubleshooting) - Common issues
