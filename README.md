# EnvCP

**Secure Environment Variable Management for AI-Assisted Coding**

EnvCP is a Model Context Protocol (MCP) server that allows developers to safely use AI assistants for coding without exposing sensitive environment variables, API keys, or secrets.

## Why EnvCP?

When using AI coding assistants, you often need to reference environment variables, API keys, or other secrets. But you don't want to share these with the AI. EnvCP solves this by:

- **Local-only storage** - Your secrets never leave your machine
- **Encrypted at rest** - AES-256-GCM encryption with PBKDF2 key derivation (100,000 iterations)
- **Reference-based access** - AI references variables by name, never sees the actual values
- **Automatic .env injection** - Values can be automatically injected into your .env files
- **AI Access Control** - Block AI from proactively checking or listing your secrets
- **Session Management** - Unlock once, stay unlocked for configurable duration

## Features

- **AES-256-GCM Encryption** - Military-grade encryption with PBKDF2-SHA512 key derivation
- **Flexible Passwords** - No complexity requirements - use any password you want
- **Session Management** - Quick password mode with configurable session duration
- **AI Access Control** - Prevent AI from actively checking variables without permission
- **Blacklist Patterns** - Block AI access to sensitive variables matching patterns
- **Project-based Organization** - Separate environments per project
- **Auto .env Sync** - Automatically sync to .env files
- **Reference System** - AI references `${VAR_NAME}` and EnvCP resolves it
- **MCP Integration** - Works with Claude Desktop and other MCP clients
- **Audit Logging** - All operations logged for security review

## Security Architecture

EnvCP uses **AES-256-GCM** (Advanced Encryption Standard with Galois/Counter Mode) for all encrypted storage:

- **Key Derivation**: PBKDF2-SHA512 with 100,000 iterations
- **Random Salt**: 64 bytes (512 bits) per encryption operation
- **Random IV**: 16 bytes (128 bits) per encryption operation
- **Authentication**: Built-in authentication tag (16 bytes) for integrity verification
- **Output Format**: `salt(128 hex) + iv(32 hex) + authTag(32 hex) + ciphertext`

This means:
- Each variable is encrypted with a unique salt and IV
- Password cracking requires brute-forcing each variable individually
- Any tampering attempt is detected via authentication tag verification
- No rainbow tables or pre-computed attacks are possible

## Installation

```bash
npm install -g envcp
```

Or use with npx:

```bash
npx envcp init
```

## Quick Start

### 1. Initialize EnvCP in your project

```bash
envcp init
```

This creates an `envcp.yaml` configuration file in your project.

### 2. Unlock your session (Quick Password Mode)

```bash
envcp unlock
# Enter your password once, stay unlocked for 30 minutes (default)
```

### 3. Add your first secret

```bash
envcp add API_KEY --value "your-secret-key"
```

Or use interactive mode:

```bash
envcp add
```

### 4. Configure Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["envcp", "serve"]
    }
  }
}
```

### 5. Use in your AI conversations

```
AI: I need to connect to your database. What's the connection string?

You: Use the DB_CONNECTION_STRING from EnvCP.

AI: [Uses EnvCP tool to get the connection string without seeing the actual value]
```

## Configuration

### envcp.yaml

```yaml
version: "1.0"
project: my-project

# Storage settings
storage:
  path: .envcp/store.enc # Where to store the encrypted data
  encrypted: true # Enable encryption (AES-256-GCM)
  algorithm: aes-256-gcm # Encryption algorithm

# Session settings (Quick Password Mode)
session:
  enabled: true # Enable session-based unlocking
  timeout: 1800 # Session duration in seconds (default: 30 minutes)

# Access rules
access:
  allow_ai_read: true # Allow AI to read variable names (not values)
  allow_ai_write: false # Allow AI to create new variables
  allow_ai_active_check: false # Prevent AI from proactively checking/listing variables
  require_confirmation: true # Require confirmation before operations
  blacklist: # Patterns to block AI access completely
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"
    - "*_KEY"

# Password validation (all optional, disabled by default)
password:
  min_length: 1 # Minimum password length (default: 1)
  require_uppercase: false # Require uppercase letters
  require_lowercase: false # Require lowercase letters
  require_numbers: false # Require numbers
  require_special: false # Require special characters

# Auto-sync to .env
sync:
  enabled: true
  target: .env # Target .env file
  exclude:
    - "*_PRIVATE" # Exclude patterns from syncing
    - "*_SECRET"

# Variables are stored separately in encrypted format
```

## CLI Commands

```bash
# Initialize EnvCP
envcp init [options]

# Session Management (Quick Password Mode)
envcp unlock              # Unlock session with password
envcp lock                # Lock session immediately
envcp status              # Check session status
envcp extend [minutes]    # Extend session duration

# Variable Management
envcp add <name> [options]
  --value, -v    Variable value
  --encrypt, -e  Encrypt the value
  --tags, -t     Tags for organization

envcp list [options]
  --show-values  Show actual values (requires unlocked session)

envcp get <name> [options]

envcp remove <name>

# Sync and Export
envcp sync [options]      # Sync to .env file

envcp export [options]
  --format       Output format: env, json, yaml

# MCP Server
envcp serve [options]     # Start MCP server
```

## MCP Tools

When using with Claude or other MCP clients, the following tools are available:

### `envcp_list`
List all available variable names (values are never shown to AI).

**Note**: This tool respects `allow_ai_active_check` setting. If disabled, AI cannot proactively list variables.

### `envcp_get`
Request a variable value. The value is masked by default and only shown to you, not the AI.

**Note**: Variables matching blacklist patterns are completely inaccessible to AI.

### `envcp_set`
Create or update a variable (if allowed by configuration).

### `envcp_sync`
Sync variables to .env file.

### `envcp_run`
Execute a command with environment variables injected.

### `envcp_check_access`
Check if AI can access a specific variable (respects blacklist and access rules).

## AI Access Control

EnvCP provides fine-grained control over what AI assistants can access:

### Disable Active Checking

By default, AI cannot proactively list or check your variables:

```yaml
access:
  allow_ai_active_check: false  # AI can't list variables without user request
```

When disabled:
- AI cannot use `envcp_list` to see what variables exist
- AI cannot proactively check for common variable names
- AI can only access variables when you explicitly tell it to

### Blacklist Patterns

Block AI from accessing sensitive variables entirely:

```yaml
access:
  blacklist:
    - "*_SECRET"      # Blocks DATABASE_SECRET, API_SECRET, etc.
    - "*_PRIVATE"     # Blocks SSH_PRIVATE, PRIVATE_KEY, etc.
    - "ADMIN_*"       # Blocks ADMIN_PASSWORD, ADMIN_TOKEN, etc.
    - "ROOT_*"        # Blocks ROOT_PASSWORD, etc.
```

Blacklisted variables:
- Cannot be read by AI (even by name)
- Cannot be listed by AI
- Only accessible via CLI or direct user action

## Password Flexibility

EnvCP allows any password you want - no complexity requirements by default:

```yaml
password:
  min_length: 1           # Even "1" is valid
  require_uppercase: false
  require_lowercase: false
  require_numbers: false
  require_special: false
```

You can enable stricter requirements if desired:

```yaml
password:
  min_length: 8
  require_uppercase: true
  require_lowercase: true
  require_numbers: true
  require_special: true
```

## Session Management

Quick Password Mode allows you to unlock once and stay unlocked:

```bash
# Unlock for 30 minutes (default)
envcp unlock

# Check status
envcp status
# Output: Session active, expires in 28 minutes

# Extend session by 15 minutes
envcp extend 15

# Lock immediately
envcp lock
```

Configure session duration in config:

```yaml
session:
  enabled: true
  timeout: 3600  # 1 hour
```

## Security Details

### Encryption Algorithm

- **Cipher**: AES-256-GCM (256-bit key, Galois/Counter Mode)
- **Key Derivation**: PBKDF2 with SHA-512
- **Iterations**: 100,000 (configurable)
- **Salt Length**: 64 bytes (512 bits)
- **IV Length**: 16 bytes (128 bits)
- **Auth Tag**: 16 bytes (128 bits)

### Why This Is Secure

1. **AES-256-GCM**: Approved by NSA for TOP SECRET information
2. **PBKDF2**: Key derivation function that makes brute-force attacks computationally expensive
3. **100,000 iterations**: Each password attempt requires 100,000 SHA-512 computations
4. **Unique salt per encryption**: Prevents rainbow table attacks and pre-computation
5. **Unique IV per encryption**: Same plaintext encrypted multiple times produces different ciphertexts
6. **Authentication tag**: Detects any tampering or corruption

### Password Security Note

While EnvCP allows simple passwords, keep in mind:
- Simple passwords (like "1" or "123") can be cracked instantly
- The encryption is only as strong as your password
- For sensitive data, use strong passwords even though they're not required

## Project Structure

```
your-project/
├── .envcp/
│   ├── config.yaml    # Project configuration
│   ├── store.enc      # Encrypted variable storage
│   ├── session.json   # Session state (auto-generated)
│   └── logs/          # Operation logs
├── .env               # Synced environment file
└── envcp.yaml         # Main config file
```

## Best Practices

1. **Never commit `.envcp/`** - Add to `.gitignore`
2. **Use strong passwords for sensitive data** - Simple passwords are allowed but not recommended
3. **Configure AI access rules** - Disable `allow_ai_active_check` for maximum security
4. **Use blacklist patterns** - Block sensitive variable patterns from AI access
5. **Review access logs** - Check `.envcp/logs/` regularly
6. **Separate projects** - Use different EnvCP instances per project

## Contributing

Contributions are welcome! Please read our contributing guidelines.

## License

MIT License - See LICENSE file for details.

## Support

- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Documentation: https://github.com/fentz26/EnvCP/wiki
