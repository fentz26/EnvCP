# API Reference

Complete reference for all EnvCP APIs, tools, and protocols.

## Table of Contents

- [Overview](#overview)
- [Server Modes](#server-modes)
- [Available Tools](#available-tools)
- [REST API](#rest-api)
- [OpenAI API](#openai-api)
- [Gemini API](#gemini-api)
- [MCP Protocol](#mcp-protocol)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Codes](#error-codes)

---

## Overview

EnvCP provides multiple API protocols for maximum compatibility:

| Protocol | Base URL | Use Case |
|----------|----------|----------|
| **REST** | `/api` | Universal HTTP API |
| **OpenAI** | `/v1` | OpenAI function calling, local LLMs |
| **Gemini** | `/v1` | Google AI function calling |
| **MCP** | stdio | Claude Desktop, Cursor, Cline |

All protocols expose the same core tools with protocol-specific formatting.

---

## Server Modes

Start EnvCP server in different modes:

```bash
# Auto-detect (recommended for HTTP)
envcp serve --mode auto --port 3456

# Specific mode
envcp serve --mode [rest|openai|gemini|mcp] --port 3456

# All modes simultaneously
envcp serve --mode all --port 3456
```

### Mode Comparison

| Mode | Protocol | Auto-detect | Best For |
|------|----------|-------------|----------|
| `auto` | HTTP | Yes | Universal server (recommended) |
| `rest` | REST API | No | Custom HTTP integrations |
| `openai` | OpenAI | No | OpenAI API, local LLMs |
| `gemini` | Gemini | No | Google AI, Gemini API |
| `mcp` | MCP (stdio) | No | Claude Desktop, editors |
| `all` | All HTTP | Yes | Multiple simultaneous clients |

---

## Available Tools

All protocols expose these 8 core tools:

### envcp_list

List all environment variable names (values never shown).

**Parameters:**
- `tags` (array of strings, optional) - Filter by tags

**Returns:**
```json
{
  "variables": ["API_KEY", "DATABASE_URL", "REDIS_URL"]
}
```

**Example:**
```bash
# REST
curl -H "X-API-Key: key" http://localhost:3456/api/tools/envcp_list

# OpenAI
curl -H "Authorization: Bearer key" \
  -d '{"name": "envcp_list", "arguments": {}}' \
  http://localhost:3456/v1/functions/call
```

---

### envcp_get

Get an environment variable value (masked by default).

**Parameters:**
- `name` (string, **required**) - Variable name
- `show_value` (boolean, optional) - Show actual value (default: false, returns masked)

**Returns:**
```json
{
  "name": "API_KEY",
  "value": "sk-...",
  "tags": ["production", "openai"],
  "description": "OpenAI API key",
  "created": "2024-01-01T00:00:00.000Z",
  "updated": "2024-01-01T00:00:00.000Z"
}
```

**Example:**
```bash
# Get masked value
curl -H "X-API-Key: key" \
  "http://localhost:3456/api/variables/API_KEY"

# Get actual value
curl -H "X-API-Key: key" \
  "http://localhost:3456/api/variables/API_KEY?show_value=true"
```

---

### envcp_set

Create or update an environment variable.

**Parameters:**
- `name` (string, **required**) - Variable name
- `value` (string, **required**) - Variable value
- `tags` (array of strings, optional) - Tags for organization
- `description` (string, optional) - Human-readable description

**Returns:**
```json
{
  "name": "API_KEY",
  "created": true,
  "updated": "2024-01-01T00:00:00.000Z"
}
```

**Example:**
```bash
curl -X POST \
  -H "X-API-Key: key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "NEW_SECRET",
    "value": "secret-value",
    "tags": ["production"],
    "description": "Production secret"
  }' \
  http://localhost:3456/api/variables
```

---

### envcp_delete

Delete an environment variable.

**Parameters:**
- `name` (string, **required**) - Variable name to delete

**Returns:**
```json
{
  "deleted": true,
  "name": "API_KEY"
}
```

**Example:**
```bash
curl -X DELETE \
  -H "X-API-Key: key" \
  http://localhost:3456/api/variables/OLD_VAR
```

---

### envcp_sync

Sync all variables to .env file (based on config).

**Parameters:** None

**Returns:**
```json
{
  "synced": 5,
  "excluded": 2,
  "file": ".env"
}
```

**Example:**
```bash
curl -X POST \
  -H "X-API-Key: key" \
  http://localhost:3456/api/sync
```

---

### envcp_run

Execute a command with specified environment variables injected.

**Parameters:**
- `command` (string, **required**) - Command to execute
- `variables` (array of strings, **required**) - Variable names to inject

**Returns:**
```json
{
  "stdout": "Command output",
  "stderr": "",
  "exitCode": 0
}
```

**Example:**
```bash
curl -X POST \
  -H "X-API-Key: key" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "npm start",
    "variables": ["API_KEY", "DATABASE_URL"]
  }' \
  http://localhost:3456/api/run
```

---

### envcp_add_to_env

Add a specific variable to a .env file.

**Parameters:**
- `name` (string, **required**) - Variable name
- `env_file` (string, optional) - Path to .env file (default: `.env`)

**Returns:**
```json
{
  "added": true,
  "file": ".env",
  "name": "API_KEY"
}
```

**Example:**
```bash
curl -X POST \
  -H "X-API-Key: key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "API_KEY",
    "env_file": ".env.local"
  }' \
  http://localhost:3456/api/tools/envcp_add_to_env
```

---

### envcp_check_access

Check if a variable exists and is accessible.

**Parameters:**
- `name` (string, **required**) - Variable name to check

**Returns:**
```json
{
  "exists": true,
  "accessible": true,
  "reason": null
}
```

Or if blocked:

```json
{
  "exists": true,
  "accessible": false,
  "reason": "Variable matches blacklist pattern"
}
```

**Example:**
```bash
curl -H "X-API-Key: key" \
  http://localhost:3456/api/access/SECRET_KEY
```

---

## REST API

Base URL: `http://localhost:3456/api`

### Authentication

```bash
# X-API-Key header (recommended)
X-API-Key: your-secret-key

# Or Authorization header
Authorization: Bearer your-secret-key
```

### Endpoints

#### GET /api/health

Health check and server status.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "1.0.0",
    "mode": "rest"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /api/tools

List all available tools.

**Response:**
```json
{
  "success": true,
  "data": {
    "tools": [
      {
        "name": "envcp_list",
        "description": "List all available environment variable names",
        "parameters": { /* schema */ }
      }
    ]
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### POST /api/tools/:name

Call a tool by name.

**Request:**
```json
{
  "name": "API_KEY",
  "show_value": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "API_KEY",
    "value": "sk-..."
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /api/variables

List all variables.

**Query Parameters:**
- `tags` (optional) - Filter by tags

**Response:**
```json
{
  "success": true,
  "data": {
    "variables": ["API_KEY", "DATABASE_URL"]
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /api/variables/:name

Get a specific variable.

**Query Parameters:**
- `show_value` (optional, boolean) - Show actual value

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "API_KEY",
    "value": "***",
    "tags": ["production"]
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### POST /api/variables

Create a new variable.

**Request:**
```json
{
  "name": "NEW_VAR",
  "value": "secret",
  "tags": ["production"],
  "description": "New secret"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "NEW_VAR",
    "created": true
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### PUT /api/variables/:name

Update an existing variable.

**Request:**
```json
{
  "value": "new-value",
  "tags": ["production", "updated"]
}
```

#### DELETE /api/variables/:name

Delete a variable.

**Response:**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "name": "OLD_VAR"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### POST /api/sync

Sync variables to .env file.

#### POST /api/run

Run command with environment variables.

**Request:**
```json
{
  "command": "npm start",
  "variables": ["API_KEY", "DATABASE_URL"]
}
```

#### GET /api/access/:name

Check variable access.

---

## OpenAI API

Base URL: `http://localhost:3456/v1`

### Authentication

```bash
Authorization: Bearer your-secret-key
```

### Endpoints

#### GET /v1/health

Health check.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "mode": "openai",
  "endpoints": [
    "/v1/models",
    "/v1/functions",
    "/v1/functions/call",
    "/v1/tool_calls",
    "/v1/chat/completions"
  ]
}
```

#### GET /v1/models

List available models (compatibility endpoint).

**Response:**
```json
{
  "object": "list",
  "data": [{
    "id": "envcp-1.0",
    "object": "model",
    "created": 1234567890,
    "owned_by": "envcp"
  }]
}
```

#### GET /v1/functions

List all function definitions.

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "name": "envcp_get",
      "description": "Get an environment variable",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Variable name" },
          "show_value": { "type": "boolean" }
        },
        "required": ["name"]
      }
    }
  ]
}
```

#### POST /v1/functions/call

Call a single function.

**Request:**
```json
{
  "name": "envcp_get",
  "arguments": {
    "name": "API_KEY",
    "show_value": true
  }
}
```

**Response:**
```json
{
  "object": "function_result",
  "name": "envcp_get",
  "result": {
    "name": "API_KEY",
    "value": "sk-..."
  }
}
```

#### POST /v1/tool_calls

Process multiple tool calls (batch).

**Request:**
```json
{
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "envcp_get",
        "arguments": "{\"name\": \"API_KEY\"}"
      }
    }
  ]
}
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"name\":\"API_KEY\",\"value\":\"sk-...\"}"
    }
  ]
}
```

#### POST /v1/chat/completions

OpenAI-compatible chat completions with tool support.

**Request:**
```json
{
  "model": "envcp-1.0",
  "messages": [
    {"role": "user", "content": "Get my API key"}
  ]
}
```

**Response:**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "envcp-1.0",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "EnvCP tools available."
    },
    "finish_reason": "stop"
  }],
  "available_tools": [/* tools */]
}
```

---

## Gemini API

Base URL: `http://localhost:3456/v1`

### Authentication

```bash
# Preferred
X-Goog-Api-Key: your-secret-key

# Or
Authorization: Bearer your-secret-key
```

### Endpoints

#### GET /v1/models

List available models.

**Response:**
```json
{
  "models": [{
    "name": "models/envcp-1.0",
    "displayName": "EnvCP Tool Server",
    "description": "Environment variable management tools",
    "supportedGenerationMethods": ["generateContent"]
  }]
}
```

#### GET /v1/tools

List function declarations.

**Response:**
```json
{
  "tools": [{
    "functionDeclarations": [
      {
        "name": "envcp_get",
        "description": "Get an environment variable",
        "parameters": {
          "type": "object",
          "properties": {
            "name": { "type": "string" }
          },
          "required": ["name"]
        }
      }
    ]
  }]
}
```

#### POST /v1/functions/call

Call a single function.

**Request:**
```json
{
  "name": "envcp_get",
  "args": {
    "name": "API_KEY",
    "show_value": true
  }
}
```

**Response:**
```json
{
  "name": "envcp_get",
  "response": {
    "result": {
      "name": "API_KEY",
      "value": "AIza..."
    }
  }
}
```

#### POST /v1/function_calls

Process multiple function calls.

**Request:**
```json
{
  "functionCalls": [
    {
      "name": "envcp_get",
      "args": { "name": "API_KEY" }
    }
  ]
}
```

**Response:**
```json
{
  "functionResponses": [
    {
      "name": "envcp_get",
      "response": {
        "result": { "name": "API_KEY", "value": "AIza..." }
      }
    }
  ]
}
```

#### POST /v1/models/envcp:generateContent

Gemini-style content generation.

**Request:**
```json
{
  "contents": [{
    "parts": [{
      "functionCall": {
        "name": "envcp_get",
        "args": { "name": "API_KEY" }
      }
    }]
  }]
}
```

**Response:**
```json
{
  "candidates": [{
    "content": {
      "parts": [{
        "functionResponse": {
          "name": "envcp_get",
          "response": { "result": { "name": "API_KEY" } }
        }
      }],
      "role": "model"
    },
    "finishReason": "STOP"
  }]
}
```

---

## MCP Protocol

MCP (Model Context Protocol) is used via stdio (standard input/output).

### Starting MCP Server

```bash
envcp serve --mode mcp
```

### MCP Configuration

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

### MCP Tools

Same 8 tools as other protocols, formatted as MCP tool definitions.

See [MCP Integration](MCP-Integration) for complete guide.

---

## Authentication

### Setting API Key

```bash
envcp serve --mode auto --api-key your-secret-key
```

### Using API Key

Different protocols accept keys differently:

| Protocol | Header | Format |
|----------|--------|--------|
| REST | `X-API-Key` or `Authorization` | `your-key` or `Bearer your-key` |
| OpenAI | `Authorization` | `Bearer your-key` |
| Gemini | `X-Goog-Api-Key` or `Authorization` | `your-key` or `Bearer your-key` |
| MCP | N/A (stdio) | Not applicable |

---

## Rate Limiting

Default rate limit: **60 requests per minute**

### Rate Limit Headers

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1234567890
```

### Rate Limit Exceeded

**Status Code:** 429

**REST Response:**
```json
{
  "success": false,
  "error": "Rate limit exceeded. Try again in 60 seconds.",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**OpenAI Response:**
```json
{
  "error": {
    "message": "Rate limit exceeded",
    "type": "rate_limit_exceeded"
  }
}
```

**Gemini Response:**
```json
{
  "error": {
    "code": 429,
    "message": "Rate limit exceeded",
    "status": "RESOURCE_EXHAUSTED"
  }
}
```

---

## Error Codes

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 200 | Success | Request completed successfully |
| 201 | Created | Variable created successfully |
| 204 | No Content | OPTIONS request (CORS) |
| 400 | Bad Request | Invalid parameters, malformed JSON |
| 401 | Unauthorized | Invalid or missing API key |
| 403 | Forbidden | Variable blacklisted, access denied |
| 404 | Not Found | Endpoint or variable not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error, storage error |
| 503 | Service Unavailable | Adapter not initialized |

### REST Error Format

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### OpenAI Error Format

```json
{
  "error": {
    "message": "Error message",
    "type": "error_type"
  }
}
```

Error types:
- `invalid_api_key`
- `invalid_request_error`
- `not_found`
- `rate_limit_exceeded`
- `internal_error`

### Gemini Error Format

```json
{
  "error": {
    "code": 400,
    "message": "Error message",
    "status": "ERROR_STATUS"
  }
}
```

Error statuses:
- `UNAUTHENTICATED` (401)
- `INVALID_ARGUMENT` (400)
- `NOT_FOUND` (404)
- `RESOURCE_EXHAUSTED` (429)
- `INTERNAL` (500)
- `UNAVAILABLE` (503)

---

## See Also

- [OpenAI Integration](OpenAI-Integration) - OpenAI API guide
- [Gemini Integration](Gemini-Integration) - Gemini API guide
- [MCP Integration](MCP-Integration) - MCP protocol guide
- [Local LLM Integration](Local-LLM-Integration) - Local LLM guide
- [CLI Reference](CLI-Reference) - CLI commands
- [Security Best Practices](Security-Best-Practices) - Security guidelines

---

**Need help?** Open an issue on [GitHub](https://github.com/fentz26/EnvCP/issues) or contact us at contact@fentz.dev
