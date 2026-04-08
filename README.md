# EnvCP

**Secure Environment Variable Management for AI-Assisted Coding**

EnvCP is a Model Context Protocol (MCP) server that allows developers to safely use AI assistants for coding without exposing sensitive environment variables, API keys, or secrets.

## Why EnvCP?

When using AI coding assistants, you often need to reference environment variables, API keys, or other secrets. But you don't want to share these with the AI. EnvCP solves this by:

- **Local-only storage** - Your secrets never leave your machine
- **Encrypted at rest** - Optional AES-256 encryption for stored values
- **Reference-based access** - AI references variables by name, never sees the actual values
- **Automatic .env injection** - Values can be automatically injected into your .env files
- **Fine-grained permissions** - Control exactly what the AI can access

## Features

- 🔐 **Encrypted Storage** - AES-256 encryption for all stored variables
- 📁 **Project-based Organization** - Separate environments per project
- 🔄 **Auto .env Sync** - Automatically sync to .env files
- 🎯 **Reference System** - AI references `${VAR_NAME}` and EnvCP resolves it
- ⚙️ **Highly Configurable** - Encryption, storage location, access rules, and more
- 🚀 **MCP Integration** - Works with Claude Desktop and other MCP clients

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

### 2. Add your first secret

```bash
envcp add API_KEY --value "your-secret-key" --encrypt
```

Or use interactive mode:

```bash
envcp add
```

### 3. Configure Claude Desktop

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

### 4. Use in your AI conversations

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
  path: .envcp/store.enc  # Where to store the encrypted data
  encrypted: true          # Enable encryption
  algorithm: aes-256-gcm   # Encryption algorithm

# Access rules
access:
  allow_ai_read: true      # Allow AI to read variable names (not values)
  allow_ai_write: false    # Allow AI to create new variables
  require_confirmation: true # Require confirmation before operations

# Auto-sync to .env
sync:
  enabled: true
  target: .env             # Target .env file
  exclude:
    - "*_PRIVATE"          # Exclude patterns from syncing
    - "*_SECRET"

# Variables are stored separately in encrypted format
```

## CLI Commands

```bash
# Initialize EnvCP
envcp init [options]

# Add a variable
envcp add <name> [options]
  --value, -v    Variable value
  --encrypt, -e  Encrypt the value
  --tags, -t     Tags for organization

# List variables (names only, values hidden)
envcp list [options]
  --show-values  Show actual values (requires password)

# Get a variable value
envcp get <name> [options]

# Update a variable
envcp update <name> [options]

# Remove a variable
envcp remove <name>

# Sync to .env file
envcp sync [options]

# Start MCP server
envcp serve [options]

# Export variables (for CI/CD)
envcp export [options]
  --format       Output format: env, json, yaml

# Import variables
envcp import <file> [options]
```

## MCP Tools

When using with Claude or other MCP clients, the following tools are available:

### `envcp_list`
List all available variable names (values are never shown to AI).

### `envcp_get`
Request a variable value. The value is masked by default and only shown to you, not the AI.

### `envcp_set`
Create or update a variable (if allowed by configuration).

### `envcp_sync`
Sync variables to .env file.

### `envcp_run`
Execute a command with environment variables injected.

## Security

- Values are encrypted using AES-256-GCM by default
- Decryption password is never stored (required for each operation)
- AI agents never see actual values, only variable references
- All operations are logged for audit purposes

## Project Structure

```
your-project/
├── .envcp/
│   ├── config.yaml     # Project configuration
│   ├── store.enc       # Encrypted variable storage
│   └── logs/           # Operation logs
├── .env                # Synced environment file
└── envcp.yaml          # Main config file
```

## Best Practices

1. **Never commit `.envcp/store.enc`** - Add to `.gitignore`
2. **Use strong passwords** - For encryption keys
3. **Tag your variables** - Organize with tags for easier management
4. **Review access logs** - Check `.envcp/logs/` regularly
5. **Separate projects** - Use different EnvCP instances per project

## Contributing

Contributions are welcome! Please read our contributing guidelines.

## License

MIT License - See LICENSE file for details.

## Support

- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Documentation: https://github.com/fentz26/EnvCP/wiki
