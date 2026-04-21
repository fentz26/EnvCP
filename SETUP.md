# Setup Guide — EnvCP

<p align="center">
<sup>
<a href="docs/i18n/SETUP.fr.md">Français</a> |
<a href="docs/i18n/SETUP.es.md">Español</a> |
<a href="docs/i18n/SETUP.ko.md">한국어</a> |
<a href="docs/i18n/SETUP.zh.md">中文</a> |
<a href="docs/i18n/SETUP.vi.md">Tiếng Việt</a> |
<a href="docs/i18n/SETUP.ja.md">日本語</a>
</sup>
</p>

← [README](README.md) · [Verification](VERIFICATION.md) · [Security Policy](SECURITY.md)

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Server Modes](#server-modes)
- [Integration Guides](#integration-guides)
- [Vault Management](#vault-management)
- [Per-Variable Password Protection](#per-variable-password-protection)
- [AI Access Control](#ai-access-control)
- [Configuration Reference](#configuration-reference)
- [Best Practices](#best-practices)

---

## Installation

### npm (recommended)

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Requires Node.js 18+ to be installed.

### Use without installing

```bash
npx @fentz26/envcp init
```

---

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

---

## CLI Reference

### Variable Management

```bash
envcp add <name> [options]   # Add a variable
envcp list [--show-values]   # List variables
envcp get <name>             # Get a variable
envcp remove <name>          # Remove a variable
envcp config                 # Open the config menu / summary
envcp rule                   # Open the rule menu / summary
```

### Vault Management

```bash
envcp vault --global init|add|list|get|delete   # Operate on global vault
envcp vault --project init|add|list|get|delete  # Operate on project vault
envcp vault --name <name> init|add|list|get|delete # Named vaults
envcp vault use <name>                           # Switch active vault
envcp vault contexts                             # List all available vaults
```

### Session Management

```bash
envcp unlock            # Unlock with password (project vault)
envcp unlock --global   # Unlock the global vault at ~/.envcp/.session
envcp lock              # Lock immediately
envcp lock --global     # Lock the global vault session
envcp status            # Check session status
envcp status --global   # Check global vault session status
envcp extend            # Extend session timeout
envcp extend --global   # Extend global vault session
```

`--global` operates on the global vault at `~/.envcp` (config, store, and
session) regardless of the current working directory. Without the flag,
the active vault is determined by the project's `envcp.yaml` (or the
global config if no project config is found in any ancestor directory).

### Sync and Export

```bash
envcp sync                            # Sync to .env file
envcp export [--format env|json|yaml] # Export variables
```

### Server

```bash
envcp serve [options]
  --mode, -m      Server mode: mcp, rest, openai, gemini, all, auto
  --port          HTTP port (default: 3456)
  --host          HTTP host (default: 127.0.0.1)
  --api-key, -k   API key for authentication
  --global        Force the global vault at ~/.envcp (skip project lookup)
```

When invoked without `--global`, `envcp serve` walks up from the current
working directory looking for an `envcp.yaml`. If none is found, it falls
back to `~/.envcp/config.yaml`. This means an MCP client can launch
`envcp serve --mode mcp` from any cwd and still find the right vault and
session as long as one of those paths exists.

---

## Server Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `auto` | Auto-detect client from headers | Universal (recommended for HTTP) |
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | REST API (HTTP) | Any HTTP client, custom integrations |
| `openai` | OpenAI function calling format | ChatGPT, GPT-4 API, OpenAI-compatible tools |
| `gemini` | Google function calling format | Gemini, Google AI |
| `all` | All HTTP protocols on same port | Multiple clients |

---

## Integration Guides

### Claude Desktop / Cursor / Cline (MCP)

Add to your MCP config file:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["-y", "@fentz26/envcp", "serve", "--mode", "mcp"]
    }
  }
}
```

### Claude Code (one-click)

```bash
npx @fentz26/envcp serve --mode mcp
```

Or add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["-y", "@fentz26/envcp", "serve", "--mode", "mcp"]
    }
  }
}
```

### Cursor (one-click)

<p>
  <a href="https://cursor.com/en/install-mcp?name=envcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmZW50ejI2L2VudmNwIiwic2VydmUiLCItLW1vZGUiLCJtY3AiXX0%3D">
    <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor">
  </a>
</p>

### Augment Code / Auggie CLI

**Via Auggie CLI:**

```bash
auggie mcp add-json envcp '{"type":"stdio","command":"npx","args":["-y","@fentz26/envcp","serve","--mode","mcp"]}'
```

**Via Augment Settings (VS Code / JetBrains):**

Import this JSON in the MCP section:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["-y", "@fentz26/envcp", "serve", "--mode", "mcp"]
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

tools = requests.get(
    "http://localhost:3456/v1/tools",
    headers={"X-Goog-Api-Key": "your-secret-key"}
).json()

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

**Endpoints:**

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

**Examples:**

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

---

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

---

## Vault Management

### Project vs Global vault

EnvCP supports two top-level vault modes:

- **Project mode (default)** — config in `./envcp.yaml`, store in
  `./.envcp/store.enc`, session in `./.envcp/.session`. Best for
  per-repo secrets that should not leak across projects.
- **Global mode** — config in `~/.envcp/config.yaml`, store in
  `~/.envcp/store.enc`, session in `~/.envcp/.session`. Best for
  secrets shared across projects (e.g. a personal API key).

Initialize a global vault:

```bash
envcp init --global       # creates ~/.envcp/config.yaml with vault.mode: global
envcp unlock --global     # writes ~/.envcp/.session
envcp serve --mode mcp    # auto-detects ~/.envcp/config.yaml when no project found
```

You can also opt into global mode declaratively in config:

```yaml
# ~/.envcp/config.yaml
vault:
  mode: global   # canonical key (preferred)
  # default: global  # legacy key, still honored if `mode` is unset
```

### Global Vault

Share secrets across multiple projects (`~/.envcp/store.enc`):

```bash
envcp vault --global init
envcp vault --global add SHARED_API_KEY --value "secret123"
envcp vault use global
envcp vault contexts
```

### Named Vaults

Create separate vaults for different contexts:

```bash
envcp vault --name work init
envcp vault --name work add WORK_API_KEY --value "work-secret"

envcp vault use work
envcp vault use project  # Back to project vault
```

---

## Per-Variable Password Protection

Add an extra layer of security with per-variable passwords:

```bash
# Create a protected variable (via API/MCP)
envcp_set name=SECRET value=mysecret protect=true variable_password=mypass

# Get a protected variable (requires password)
envcp_get name=SECRET variable_password=mypass

# Remove protection
envcp_set name=SECRET unprotect=true variable_password=mypass
```

Protected variables use Argon2id + AES-256-GCM encryption with a variable-specific key.

---

## AI Access Control

### Deny-by-Default Flags

All AI access flags default to `false`:

```yaml
access:
  allow_ai_read: true           # Let AI read variable values
  allow_ai_write: false         # Let AI create/update variables
  allow_ai_delete: false        # Let AI delete variables
  allow_ai_active_check: false  # Prevent AI from proactively listing
  allow_ai_execute: false       # Let AI run commands (requires api_key)
  require_confirmation: true    # Prompt user before sensitive operations
```

> `allow_ai_execute` requires `server.api_key` to be set — the server will refuse to start without it.

### Blacklist Patterns

Block AI from accessing sensitive variables:

```yaml
access:
  blacklist_patterns:
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"
    - "ROOT_*"
```

---

## Configuration Reference

Full `envcp.yaml` options:

```yaml
version: "1.0"
project: my-project

vault:
  default: project          # or "global"
  global_path: .envcp/store.enc

storage:
  path: .envcp/store.enc
  encrypted: true
  algorithm: aes-256-gcm

session:
  enabled: true
  timeout_minutes: 30
  max_extensions: 5

access:
  allow_ai_read: true
  allow_ai_write: false
  allow_ai_active_check: false
  require_variable_password: false
  require_confirmation: true
  blacklist_patterns:
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"

password:
  min_length: 8
  require_complexity: false
  allow_numeric_only: false

sync:
  enabled: true
  target: .env
  exclude:
    - "*_PRIVATE"
    - "*_SECRET"
```

---

## Best Practices

1. **Never commit `.envcp/`** — Add to `.gitignore`
2. **Use API keys for HTTP modes** — Protect your server endpoints
3. **Disable `allow_ai_active_check`** — Prevent AI from probing for variables
4. **Use blacklist patterns** — Block sensitive variable patterns
5. **Use `auto` mode for HTTP** — Let EnvCP detect the client type
6. **Review access logs** — Check `.envcp/logs/` regularly
7. **Lock sessions when idle** — `envcp lock` when stepping away
8. **Use per-variable passwords** for your most sensitive secrets

---

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

---

## Support

- Email: contact@envcp.org
- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Documentation: https://envcp.org/docs
