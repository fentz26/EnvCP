# EnvCP

**Secure Environment Variable Management for AI-Assisted Coding**

EnvCP is a Model Context Protocol (MCP) server that allows developers to safely use AI assistants for coding without exposing sensitive environment variables, API keys, or secrets.

## Why EnvCP?

When using AI coding assistants, you often need to reference environment variables, API keys, or other secrets. But you don't want to share these with the AI. EnvCP solves this by:

- **Local-only storage** - Your secrets never leave your machine
- **Encrypted at rest** - AES-256-GCM encryption with PBKDF2 key derivation (100,000 iterations)
- **Reference-based access** - AI references variables by name, never sees the actual values
- **Automatic .env injection** - Values can be automatically injected into your .env files
- **Fine-grained permissions** - Control exactly what the AI can access

## Features

- **Military-grade Encryption** - AES-256-GCM with PBKDF2-SHA512 key derivation, random salt and IV per encryption
- **Project-based Organization** - Separate environments per project
- **Auto .env Sync** - Automatically sync to .env files
- **Reference System** - AI references `${VAR_NAME}` and EnvCP resolves it
- **Highly Configurable** - Encryption, storage location, access rules, and more
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

### 2. Add your first secret

```bash
envcp add API_KEY --value "your-secret-key"
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
  path: .envcp/store.enc # Where to store the encrypted data
  encrypted: true # Enable encryption (AES-256-GCM)
  algorithm: aes-256-gcm # Encryption algorithm

# Access rules
access:
  allow_ai_read: true # Allow AI to read variable names (not values)
  allow_ai_write: false # Allow AI to create new variables
  require_confirmation: true # Require confirmation before operations

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

# Add a variable
envcp add <name> [options]
  --value, -v Variable value
  --encrypt, -e Encrypt the value
  --tags, -t Tags for organization

# List variables (names only, values hidden)
envcp list [options]
  --show-values Show actual values (requires password)

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
  --format Output format: env, json, yaml

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

### Estimated Crack Time

Assuming:
- 8-character password with mixed case, numbers, symbols (~6 quadrillion combinations)
- PBKDF2 with 100,000 iterations

Single GPU attempt: ~1,000 passwords/second
All GPUs in the world (~1 billion): ~1 trillion passwords/second

**Time to crack**: Approximately 6,000 years minimum

With a 12+ character password: Heat death of the universe

## Project Structure

```
your-project/
├── .envcp/
│   ├── config.yaml # Project configuration
│   ├── store.enc # Encrypted variable storage
│   └── logs/ # Operation logs
├── .env # Synced environment file
└── envcp.yaml # Main config file
```

## Best Practices

1. **Never commit `.envcp/store.enc`** - Add to `.gitignore`
2. **Use strong passwords** - Minimum 12 characters, mixed case, numbers, symbols
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
