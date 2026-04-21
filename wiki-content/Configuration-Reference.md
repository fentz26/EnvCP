# Configuration Reference

Complete guide to configuring EnvCP via `envcp.yaml`.

## Configuration File Location

The `envcp.yaml` file is created in your project root when you run `envcp init`. It controls all aspects of EnvCP's behavior.

## Complete Configuration Example

```yaml
version: "1.0"
project: my-awesome-project

vault:
  default: project          # project | global
  global_path: .envcp/store.enc

storage:
  path: .envcp/store.enc
  encrypted: true

session:
  enabled: true
  timeout_minutes: 30
  max_extensions: 5
  path: .envcp/.session

encryption:
  enabled: true

security:
  mode: recoverable         # recoverable | hard-lock
  recovery_file: .envcp/.recovery

keychain:
  enabled: false
  service: envcp

access:
  allow_ai_read: false
  allow_ai_write: false
  allow_ai_delete: false
  allow_ai_export: false
  allow_ai_execute: false
  allow_ai_active_check: false
  require_user_reference: true
  require_confirmation: true
  mask_values: true
  audit_log: true
  require_variable_password: false
  blacklist_patterns:
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"

password:
  min_length: 8
  require_complexity: false
  allow_numeric_only: false
  allow_single_char: false

sync:
  enabled: false
  target: .env
  exclude: []
  format: dotenv            # dotenv | json | yaml

server:
  mode: auto                # mcp | rest | openai | gemini | all | auto
  port: 3456
  host: 127.0.0.1
  cors: true
  api_key: ""
  auto_detect: true
  rate_limit:
    enabled: true
    requests_per_minute: 60
    whitelist: []
```

## Configuration Sections

### Basic Settings

```yaml
version: "1.0"
project: my-project-name
```

- **version**: Configuration schema version (always `"1.0"`)
- **project**: Human-readable project name (defaults to directory name)

---

### vault

Controls which vault is active by default and where the global vault is stored.

```yaml
vault:
  default: project
  global_path: .envcp/store.enc
```

- **default**: Default vault context — `project` (per-project store) or `global` (shared across projects). Default: `project`
- **global_path**: Path to the global vault file. Default: `.envcp/store.enc`

See [vault use](CLI-Reference#vault-use) to change the active vault at runtime.

---

### storage

Controls where and how variables are stored.

```yaml
storage:
  path: .envcp/store.enc
  encrypted: true
```

- **path**: Location of the encrypted store file relative to the project root. Default: `.envcp/store.enc`
- **encrypted**: Enable encryption. Set to `false` only for local development without sensitive data. Default: `true`

---

### encryption

```yaml
encryption:
  enabled: true
```

- **enabled**: Master switch for encryption. When `false`, no password is required. Default: `true`

---

### security

```yaml
security:
  mode: recoverable
  recovery_file: .envcp/.recovery
  brute_force_protection:
    enabled: true
    max_attempts: 5
    lockout_duration: 300
    progressive_delay: true
    max_delay: 60
    permanent_lockout_threshold: 50
    permanent_lockout_action: require_recovery_key
    notifications: {}
```

- **mode**:
  - `recoverable` — Password can be reset using a recovery key. The recovery key is generated during `init` and must be saved securely.
  - `hard-lock` — No recovery possible. Losing the password means losing all data. Maximum security.
- **recovery_file**: Path to the encrypted recovery data file. Default: `.envcp/.recovery`

**Brute-force protection**:

- **enabled**: Enable brute-force protection. Default: `true`
- **max_attempts**: Number of consecutive failed attempts before temporary lockout. Default: `5`
- **lockout_duration**: Lockout duration in seconds after reaching max attempts. Default: `300` (5 minutes)
- **progressive_delay**: Enable progressive delays between attempts (60s, 120s, 240s...). Default: `true`
- **max_delay**: Maximum progressive delay in seconds. Default: `60`
- **permanent_lockout_threshold**: Total failed attempts across all sessions before requiring recovery key. Default: `50`
- **permanent_lockout_action**: Action when permanent lockout threshold reached. Options: `require_recovery_key` (default), `require_admin`, `permanent_lock`.
- **notifications**: Placeholder for future notification settings.

---
### advanced_security_features

Advanced security features introduced in v1.2.0:

**Memory hardening** (always enabled):

- Zero-sensitive memory: Sensitive buffers explicitly zeroed after use
- Prevent swapping: `mlock` locks memory to prevent disk swap
- Core dump prevention: Core dumps disabled on Linux
- Fallback protection: Secure JavaScript implementations when native modules unavailable

**Configuration file integrity protection** (always enabled):

- HMAC-SHA256 signing of `envcp.yaml`
- Tamper detection blocks server startup
- Signature stored in `.envcp/.config_signature`
- Automatic signature updates on config save


### session

Controls how long you stay unlocked after entering your password.

```yaml
session:
  enabled: true
  timeout_minutes: 30
  max_extensions: 5
  path: .envcp/.session
```

- **enabled**: Enable session management. When `false`, password is required every time. Default: `true`
- **timeout_minutes**: Session duration in minutes. Default: `30`
- **max_extensions**: Maximum number of times a session can be extended with `envcp extend`. Default: `5`
- **path**: Session file path. Default: `.envcp/.session`

**Common values**:

| Use case      | timeout_minutes |
|---------------|----------------|
| Maximum security | 5           |
| Normal use    | 30              |
| Development   | 480 (8 hours)   |
| Rarely lock   | 1440 (24 hours) |

---

### keychain

Enable OS keychain integration for passwordless auto-unlock.

```yaml
keychain:
  enabled: false
  service: envcp
```

- **enabled**: Auto-unlock from OS keychain on session start. Default: `false`
- **service**: Keychain service name. Default: `envcp`

Enable with `envcp keychain save` or `envcp unlock --save-to-keychain`.

**Supported backends**:
- macOS: Keychain
- Linux: libsecret (GNOME Keyring / KWallet)
- Windows: Windows Credential Manager

---

### access

Controls what AI tools are allowed to do with your variables.

```yaml
access:
  allow_ai_read: false
  allow_ai_write: false
  allow_ai_delete: false
  allow_ai_export: false
  allow_ai_execute: false
  allow_ai_active_check: false
  require_user_reference: true
  require_confirmation: true
  mask_values: true
  audit_log: true
  require_variable_password: false
  allowed_commands: []
  allowed_patterns: []
  denied_patterns: []
  blacklist_patterns: []
```

#### Permission flags

| Field | Default | Description |
|-------|---------|-------------|
| `allow_ai_read` | `false` | AI can read variable values |
| `allow_ai_write` | `false` | AI can create/update variables |
| `allow_ai_delete` | `false` | AI can delete variables |
| `allow_ai_export` | `false` | AI can export variables |
| `allow_ai_execute` | `false` | AI tools may execute commands when an adapter/server exposes that capability |
| `allow_ai_active_check` | `false` | AI can proactively list/check variables without being asked |

When `allow_ai_active_check` is `false`, the AI can only access variables when you explicitly ask it to.

#### variable_rules

- **Type**: object keyed by variable name — Default: `{}`
- Override access for specific variables. Each variable may define `allow_ai_read`, `allow_ai_write`, `allow_ai_delete`, `allow_ai_export`, `allow_ai_execute`, `require_confirmation`, and an optional `active_window`.

```yaml
access:
  variable_rules:
    OPENAI_API_KEY:
      allow_ai_read: true
      allow_ai_execute: false
      require_confirmation: true
      active_window:
        start: "09:00"
        end: "18:00"
```

#### client_rules

- **Type**: object keyed by client id — Default: `{}`
- Override default access or per-variable rules for one client such as `mcp`, `openai`, `gemini`, `api`, or a custom client id.

```yaml
access:
  client_rules:
    openai:
      allow_ai_active_check: true
      allow_ai_read: true
      variable_rules:
        OPENAI_API_KEY:
          allow_ai_read: true
          allow_ai_execute: false
```

#### require_user_reference

- **Type**: boolean — Default: `true`
- Require the user to explicitly reference a variable by name before AI can access it. Prevents the AI from scanning secrets unprompted.

#### require_confirmation

- **Type**: boolean — Default: `true`
- Prompt for confirmation before providing values to AI.

#### mask_values

- **Type**: boolean — Default: `true`
- Show masked values (e.g., `sk-1****890`) instead of full values in AI responses.

#### audit_log

- **Type**: boolean — Default: `true`
- Log all AI access operations to `.envcp/logs/`.

#### require_variable_password

- **Type**: boolean — Default: `false`
- When `true`, variables with per-variable password protection must have their password supplied to be accessed via AI tools. See [Per-Variable Password Protection](#per-variable-password-protection).

#### allowed_commands

- **Type**: array of strings — Default: `[]` (all commands)
- Restrict which shell commands AI tools can run through EnvCP-managed adapters. Empty list = no restriction.

```yaml
allowed_commands:
  - "npm test"
  - "npm run build"
```

#### Pattern filters

```yaml
# Deny specific patterns (blacklist)
blacklist_patterns:
  - "*_SECRET"
  - "*_PRIVATE"
  - "ADMIN_*"

# Deny additional patterns
denied_patterns:
  - "PROD_*"

# Allow ONLY these patterns (overrides blacklist when non-empty)
allowed_patterns:
  - "PUBLIC_*"
  - "API_KEY"
```

- **blacklist_patterns**: Variable name patterns AI cannot access (glob syntax: `*`, `?`, `[abc]`)
- **denied_patterns**: Additional patterns to deny
- **allowed_patterns**: When non-empty, AI can only access variables matching these patterns (overrides blacklist)

---

### password

Controls vault password requirements. These rules apply when setting a new password during `init`, `unlock`, or `recover`.

```yaml
password:
  min_length: 8
  require_complexity: false
  allow_numeric_only: false
  allow_single_char: false
```

- **min_length**: Minimum password length. Default: `8`
- **require_complexity**: Require at least 3 of: lowercase, uppercase, numbers, special characters. Default: `false`
- **allow_numeric_only**: Allow passwords made entirely of digits. Default: `false`
- **allow_single_char**: Allow single-character passwords. Default: `false`

Common weak passwords (e.g., `password123`, `12345678`) are always rejected regardless of policy.

**Strict example**:

```yaml
password:
  min_length: 16
  require_complexity: true
  allow_numeric_only: false
  allow_single_char: false
```

---

### sync

Controls automatic syncing of variables to a plain-text `.env` file.

```yaml
sync:
  enabled: false
  target: .env
  exclude: []
  include: []
  format: dotenv
  header: ""
```

- **enabled**: Enable sync to plain-text file. Default: `false`
- **target**: Target file path (must be relative). Default: `.env`
- **exclude**: Variable name patterns to exclude from sync (glob syntax)
- **include**: If non-empty, only sync variables matching these patterns
- **format**: Output format — `dotenv`, `json`, `yaml`. Default: `dotenv`
- **header**: Optional comment header prepended to the output file

**Example**:

```yaml
sync:
  enabled: true
  target: .env.local
  exclude:
    - "*_PROD_*"
    - "*_SECRET"
  format: dotenv
  header: "# Auto-generated by EnvCP — do not edit manually"
```

**Note**: `.env` files are plain text. Avoid syncing highly sensitive variables. Add your sync target to `.gitignore`.

---

### server

Configuration for the EnvCP HTTP/MCP server (`envcp serve`).

```yaml
server:
  mode: auto
  port: 3456
  host: 127.0.0.1
  cors: true
  api_key: ""
  auto_detect: true
  rate_limit:
    enabled: true
    requests_per_minute: 60
    whitelist: []
```

- **mode**: Server mode — `mcp`, `rest`, `openai`, `gemini`, `all`, `auto`. Default: `auto`
- **port**: HTTP port (not used for MCP stdio mode). Default: `3456`
- **host**: Bind address. Use `127.0.0.1` (localhost only) or `0.0.0.0` (all interfaces). Default: `127.0.0.1`
- **cors**: Enable CORS headers. Default: `true`
- **api_key**: Required API key for HTTP authentication. Empty = no auth required (use only on localhost)
- **auto_detect**: Auto-detect client type from request headers in `auto` mode. Default: `true`

#### rate_limit

```yaml
rate_limit:
  enabled: true
  requests_per_minute: 60
  whitelist:
    - "127.0.0.1"
```

- **enabled**: Enable rate limiting. Default: `true`
- **requests_per_minute**: Maximum requests per minute per client IP. Default: `60`
- **whitelist**: IP addresses excluded from rate limiting (e.g., trusted internal services)

---

## Per-Variable Password Protection

Individual variables can be protected with a second password, separate from the vault password. Protected variables cannot be read by AI tools unless the variable password is supplied.

Per-variable protection is managed through the AI tool API — the AI can set or remove protection when you ask it to:

- `protect=true` + `variable_password` → protect the variable
- `unprotect=true` + `variable_password` → remove protection

When `access.require_variable_password` is `true`, protected variables are completely hidden from AI reads unless the password is provided inline.

---

## Environment-Specific Configurations

Create different config files for different environments:

```bash
envcp.dev.yaml
envcp.prod.yaml
envcp.test.yaml
```

Use a specific config:

```bash
# Open the matching project/config directory first
cd /path/to/prod-project && envcp serve
cd /path/to/dev-project && envcp list
```

---

## Configuration Examples

### Maximum Security

```yaml
version: "1.0"
project: secure-project

storage:
  path: .envcp/store.enc
  encrypted: true

security:
  mode: hard-lock

session:
  enabled: true
  timeout_minutes: 5
  max_extensions: 1

access:
  allow_ai_read: true
  allow_ai_write: false
  allow_ai_delete: false
  allow_ai_export: false
  allow_ai_active_check: false
  require_confirmation: true
  mask_values: true
  blacklist_patterns:
    - "*_SECRET"
    - "*_KEY"
    - "*TOKEN*"
    - "ADMIN_*"
    - "PROD_*"

password:
  min_length: 16
  require_complexity: true

sync:
  enabled: false
```

### Development Friendly

```yaml
version: "1.0"
project: dev-project

security:
  mode: recoverable

session:
  enabled: true
  timeout_minutes: 480

keychain:
  enabled: true

access:
  allow_ai_read: true
  allow_ai_write: true
  allow_ai_active_check: false
  require_confirmation: false
  mask_values: false
  blacklist_patterns:
    - "PROD_*"

password:
  min_length: 8

sync:
  enabled: true
  target: .env.local
  exclude:
    - "PROD_*"
```

### Team Shared Settings

```yaml
version: "1.0"
project: team-project

security:
  mode: recoverable

session:
  enabled: true
  timeout_minutes: 60

access:
  allow_ai_read: true
  allow_ai_write: false
  allow_ai_delete: false
  allow_ai_active_check: false
  require_confirmation: true
  mask_values: true
  audit_log: true
  blacklist_patterns:
    - "*_PROD_*"
    - "*_SECRET"
    - "ADMIN_*"

password:
  min_length: 12
  require_complexity: true

sync:
  enabled: true
  target: .env.local
  exclude:
    - "*_SECRET"
    - "*_PROD_*"

server:
  rate_limit:
    enabled: true
    requests_per_minute: 30
```

## Next Steps

- [CLI Reference](CLI-Reference) - All CLI commands
- [MCP Integration](MCP-Integration) - Set up with Claude/Cursor
- [Security Best Practices](Security-Best-Practices) - Secure your setup
- [Session Management](Session-Management) - Understanding sessions
