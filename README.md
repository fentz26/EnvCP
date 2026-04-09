

<p align="center">
  <a href="https://envcp.fentz.dev"><img src="./assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>
<p align="center">
  <strong>Secure Environment Variable Management for AI agent</strong>
</p>

##
<p align="center">
  <a href="https://www.npmjs.com/package/@fentz26/envcp"><img src="https://img.shields.io/npm/v/%40fentz26%2Fenvcp?style=flat-square&color=000000&labelColor=000000&label=version" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@fentz26/envcp"><img src="https://img.shields.io/npm/unpacked-size/%40fentz26%2Fenvcp?style=flat-square&color=000000&labelColor=000000&label=size" alt="npm size"></a>
  <a href="https://github.com/fentz26/EnvCP/actions"><img src="https://img.shields.io/github/actions/workflow/status/fentz26/EnvCP/ci.yml?style=flat-square&color=000000&labelColor=000000&label=ci" alt="CI"></a>
  <a href="https://github.com/fentz26/EnvCP/blob/main/LICENSE"><img src="https://img.shields.io/github/license/fentz26/EnvCP?style=flat-square&color=000000&labelColor=000000" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/%40fentz26%2Fenvcp?style=flat-square&color=000000&labelColor=000000&label=node" alt="node version"></a>
</p>

<p align="center">
  <a href="https://cursor.com/en/install-mcp?name=envcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmZW50ejI2L2VudmNwIiwic2VydmUiLCItLW1vZGUiLCJtY3AiXX0%3D"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor"></a>
</p>

<p align="center">
  EnvCP lets you safely use AI agent without exposing your secrets.<br>
  Your API keys and environment variables stay encrypted on your machine — AI only references them by name.
</p>

## Installation

### npm

```bash
npm install -g @fentz26/envcp
```

### curl

```bash
curl -fsSL https://envcp.fentz.dev/install.sh | bash
```

### Use without installing

```bash
npx @fentz26/envcp init
```

## Quick Start

```bash
# 1. Initialize in your project
envcp init

# 2. Add your secrets
envcp add API_KEY --value "your-secret-key"
envcp add DATABASE_URL --value "postgres://..."

# 3. Start the server (auto-detects client type)
envcp serve --mode auto --port 3456
```

## Basic CLI Commands

```bash
# Variable Management
envcp add <name> [options]    # Add a variable
envcp list [--show-values]    # List variables
envcp get <name>              # Get a variable
envcp remove <name>           # Remove a variable

# Session Management
envcp unlock                  # Unlock with password
envcp lock                    # Lock immediately
envcp status                  # Check session status

# Sync and Export
envcp sync                    # Sync to .env file
envcp export [--format env|json|yaml]
```

## Why EnvCP?

- **Local-only storage** — Your secrets never leave your machine
- **Encrypted at rest** — AES-256-GCM with PBKDF2 key derivation (100,000 iterations)
- **Reference-based access** — AI references variables by name, never sees the actual values
- **Automatic .env injection** — Values can be automatically injected into your .env files
- **AI Access Control** — Block AI from proactively listing or checking your secrets
- **Universal Compatibility** — Works with any AI tool via MCP, OpenAI, Gemini, or REST protocols

---

## Integration Guides

### Claude Desktop / Cursor / Cline (MCP)

Add to your MCP config file:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"]
    }
  }
}
```

### ChatGPT / OpenAI API

```bash
envcp serve --mode openai --port 3456 --api-key your-secret-key
```

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="your-secret-key"
)

# Call a function
result = client.post("/functions/call", json={
    "name": "envcp_get",
    "arguments": {"name": "API_KEY"}
})
```

### Gemini / Google AI

```bash
envcp serve --mode gemini --port 3456 --api-key your-secret-key
```

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

```bash
# OpenAI-compatible (works with most local LLM tools)
envcp serve --mode openai --port 3456

# Or universal REST
envcp serve --mode rest --port 3456
```

Configure your LLM tool to use `http://localhost:3456` as the tool server.

### REST API (Universal)

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
| `auto` | Auto-detect client from headers | Universal (recommended for HTTP) |
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | REST API (HTTP) | Any HTTP client, custom integrations |
| `openai` | OpenAI function calling format | ChatGPT, GPT-4 API, OpenAI-compatible tools |
| `gemini` | Google function calling format | Gemini, Google AI |
| `all` | All HTTP protocols on same port | Multiple clients |

```bash
envcp serve [options]
  --mode, -m      Server mode: mcp, rest, openai, gemini, all, auto
  --port          HTTP port (default: 3456)
  --host          HTTP host (default: 127.0.0.1)
  --api-key, -k   API key for authentication
  --password, -p  Encryption password
```

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

## Configuration (envcp.yaml)

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

### Encryption Details

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

1. **Never commit `.envcp/`** — Add to `.gitignore`
2. **Use API keys for HTTP modes** — Protect your server endpoints
3. **Disable `allow_ai_active_check`** — Prevent AI from probing for variables
4. **Use blacklist patterns** — Block sensitive variable patterns
5. **Use `auto` mode for HTTP** — Let EnvCP detect the client type
6. **Review access logs** — Check `.envcp/logs/` regularly

## License

MIT License — See LICENSE file for details.

## Support
- Email: contact@fentz.dev
- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Documentation: https://envcp.fentz.dev/docs
