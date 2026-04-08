# EnvCP

**Secure Environment Variable Management for AI-Assisted Coding**

EnvCP is a universal tool server that allows developers to safely use AI assistants for coding without exposing sensitive environment variables, API keys, or secrets. Works with Claude, ChatGPT, Gemini, Cursor, and any AI tool.

## Why EnvCP?

When using AI coding assistants, you often need to reference environment variables, API keys, or other secrets. But you don't want to share these with the AI. EnvCP solves this by:

- **Local-only storage** - Your secrets never leave your machine
- **Encrypted at rest** - AES-256-GCM encryption with PBKDF2 key derivation (100,000 iterations)
- **Reference-based access** - AI references variables by name, never sees the actual values
- **Automatic .env injection** - Values can be automatically injected into your .env files
- **AI Access Control** - Block AI from proactively checking or listing your secrets
- **Universal Compatibility** - Works with any AI tool via multiple protocols

## Platform Compatibility

| Platform | Support | Protocol |
|----------|---------|----------|
| Claude Desktop | Native | MCP |
| Claude Code | Native | MCP |
| Cursor | Native | MCP |
| Cline (VS Code) | Native | MCP |
| Continue.dev | Native | MCP |
| Zed Editor | Native | MCP |
| ChatGPT | Via API | OpenAI Function Calling |
| GPT-4 API | Via API | OpenAI Function Calling |
| Gemini | Via API | Google Function Calling |
| Gemini API | Via API | Google Function Calling |
| Local LLMs (Ollama) | Via API | REST / OpenAI-compatible |
| LM Studio | Via API | REST / OpenAI-compatible |
| Open WebUI | Via API | REST |
| Any HTTP Client | Via API | REST |

## Features

- **Multi-Protocol Support** - MCP, REST API, OpenAI, and Gemini protocols
- **Auto-Detection** - Automatically detects client type from request headers
- **AES-256-GCM Encryption** - Military-grade encryption with PBKDF2-SHA512 key derivation
- **Flexible Passwords** - No complexity requirements - use any password you want
- **Session Management** - Quick password mode with configurable session duration
- **AI Access Control** - Prevent AI from actively checking variables without permission
- **Blacklist Patterns** - Block AI access to sensitive variables matching patterns
- **Project-based Organization** - Separate environments per project
- **Auto .env Sync** - Automatically sync to .env files
- **Audit Logging** - All operations logged for security review

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

### 2. Add your secrets

```bash
envcp add API_KEY --value "your-secret-key"
envcp add DATABASE_URL --value "postgres://..."
```

### 3. Start the server

```bash
# Auto mode - detects client type automatically (recommended)
envcp serve --mode auto --port 3456

# Or specific modes:
envcp serve --mode mcp       # For Claude Desktop, Cursor, etc.
envcp serve --mode rest      # For REST API clients
envcp serve --mode openai    # For ChatGPT/OpenAI-compatible
envcp serve --mode gemini    # For Google Gemini
envcp serve --mode all       # All protocols on same port
```

## Integration Guides

### Claude Desktop / Cursor / Cline (MCP)

Add to your config file:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["envcp", "serve", "--mode", "mcp"]
    }
  }
}
```

### ChatGPT / OpenAI API

Start the server in OpenAI mode:

```bash
envcp serve --mode openai --port 3456 --api-key your-secret-key
```

Use with OpenAI client:

```python
import openai

# Point to EnvCP server
client = openai.OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="your-secret-key"
)

# Get available functions
functions = client.get("/functions")

# Call a function
result = client.post("/functions/call", json={
    "name": "envcp_get",
    "arguments": {"name": "API_KEY"}
})
```

### Gemini / Google AI

Start the server in Gemini mode:

```bash
envcp serve --mode gemini --port 3456 --api-key your-secret-key
```

Use with Gemini:

```python
import requests

# Get available tools
tools = requests.get(
    "http://localhost:3456/v1/tools",
    headers={"X-Goog-Api-Key": "your-secret-key"}
).json()

# Call a function
result = requests.post(
    "http://localhost:3456/v1/functions/call",
    headers={"X-Goog-Api-Key": "your-secret-key"},
    json={"name": "envcp_get", "args": {"name": "API_KEY"}}
).json()
```

### Local LLMs (Ollama, LM Studio)

For local LLMs, use REST API mode or OpenAI-compatible mode:

```bash
# REST API (universal)
envcp serve --mode rest --port 3456

# OpenAI-compatible (works with most local LLM tools)
envcp serve --mode openai --port 3456
```

Then configure your LLM tool to use `http://localhost:3456` as the tool server.

### REST API (Universal)

Start the server:

```bash
envcp serve --mode rest --port 3456 --api-key your-secret-key
```

Endpoints:

```
GET    /api/health              - Health check
GET    /api/variables           - List variables
GET    /api/variables/:name     - Get variable
POST   /api/variables           - Create variable
PUT    /api/variables/:name     - Update variable
DELETE /api/variables/:name     - Delete variable
POST   /api/sync                - Sync to .env
POST   /api/run                 - Run command with env vars
GET    /api/tools               - List available tools
POST   /api/tools/:name         - Call tool by name
```

Example:

```bash
# List variables
curl -H "X-API-Key: your-secret-key" http://localhost:3456/api/variables

# Get a variable
curl -H "X-API-Key: your-secret-key" http://localhost:3456/api/variables/API_KEY

# Create a variable
curl -X POST -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "NEW_VAR", "value": "secret123"}' \
  http://localhost:3456/api/variables
```

## Server Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | REST API (HTTP) | Any HTTP client, custom integrations |
| `openai` | OpenAI function calling format | ChatGPT, GPT-4 API, OpenAI-compatible tools |
| `gemini` | Google function calling format | Gemini, Google AI |
| `all` | All HTTP protocols on same port | Multiple clients |
| `auto` | Auto-detect client from headers | Universal (recommended for HTTP) |

## CLI Commands

```bash
# Initialize
envcp init [options]

# Session Management
envcp unlock              # Unlock session with password
envcp lock                # Lock session immediately
envcp status              # Check session status
envcp extend [minutes]    # Extend session duration

# Variable Management
envcp add <name> [options]
envcp list [--show-values]
envcp get <name>
envcp remove <name>

# Sync and Export
envcp sync                # Sync to .env file
envcp export [--format env|json|yaml]

# Server
envcp serve [options]
  --mode, -m      Server mode: mcp, rest, openai, gemini, all, auto
  --port          HTTP port (default: 3456)
  --host          HTTP host (default: 127.0.0.1)
  --api-key, -k   API key for authentication
  --password, -p  Encryption password
```

## Configuration

### envcp.yaml

```yaml
version: "1.0"
project: my-project

storage:
  path: .envcp/store.enc
  encrypted: true
  algorithm: aes-256-gcm

session:
  enabled: true
  timeout: 1800  # 30 minutes

access:
  allow_ai_read: true
  allow_ai_write: false
  allow_ai_active_check: false  # Prevent AI from proactively listing
  require_confirmation: true
  blacklist:
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"

password:
  min_length: 1  # No requirements by default
  require_uppercase: false
  require_lowercase: false
  require_numbers: false
  require_special: false

sync:
  enabled: true
  target: .env
  exclude:
    - "*_PRIVATE"
    - "*_SECRET"
```

## Available Tools

All protocols expose the same tools:

| Tool | Description |
|------|-------------|
| `envcp_list` | List variable names (not values) |
| `envcp_get` | Get a variable (masked by default) |
| `envcp_set` | Create/update a variable |
| `envcp_delete` | Delete a variable |
| `envcp_sync` | Sync to .env file |
| `envcp_run` | Run command with env vars injected |
| `envcp_check_access` | Check if variable is accessible |

## AI Access Control

### Disable Active Checking

Prevent AI from proactively listing your variables:

```yaml
access:
  allow_ai_active_check: false
```

### Blacklist Patterns

Block AI from accessing sensitive variables:

```yaml
access:
  blacklist:
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"
    - "ROOT_*"
```

## Security

### Encryption

- **Cipher**: AES-256-GCM
- **Key Derivation**: PBKDF2-SHA512 (100,000 iterations)
- **Salt**: 64 bytes per encryption
- **IV**: 16 bytes per encryption
- **Auth Tag**: 16 bytes for integrity

### API Authentication

When using HTTP modes, always set an API key:

```bash
envcp serve --mode rest --api-key your-secret-key
```

Clients must include the key in requests:

```
X-API-Key: your-secret-key
# or
Authorization: Bearer your-secret-key
```

## Best Practices

1. **Never commit `.envcp/`** - Add to `.gitignore`
2. **Use API keys for HTTP modes** - Protect your server endpoints
3. **Disable `allow_ai_active_check`** - Prevent AI from probing for variables
4. **Use blacklist patterns** - Block sensitive variable patterns
5. **Use `auto` mode for HTTP** - Let EnvCP detect the client type
6. **Review access logs** - Check `.envcp/logs/` regularly

## License

MIT License - See LICENSE file for details.

## Support

- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Documentation: https://github.com/fentz26/EnvCP/wiki
