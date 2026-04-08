# OpenAI Integration

Complete guide for integrating EnvCP with OpenAI's function calling API, ChatGPT, and OpenAI-compatible tools.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [OpenAI Function Calling](#openai-function-calling)
- [Available Endpoints](#available-endpoints)
- [Python Examples](#python-examples)
- [Node.js Examples](#nodejs-examples)
- [Authentication](#authentication)
- [Error Handling](#error-handling)
- [Advanced Usage](#advanced-usage)
- [Troubleshooting](#troubleshooting)

---

## Overview

EnvCP provides a complete OpenAI function calling-compatible API server. This allows you to:

- Use EnvCP with ChatGPT via function calling
- Integrate with OpenAI API (GPT-4, GPT-3.5-turbo)
- Connect OpenAI-compatible tools (Ollama, LM Studio, Jan, etc.)
- Build custom OpenAI-based applications with secure env var access

**Base URL:** `http://localhost:3456/v1`

---

## Quick Start

### 1. Start the Server

```bash
# Start in OpenAI mode
envcp serve --mode openai --port 3456 --api-key your-secret-key

# Or use auto-detect mode (recommended)
envcp serve --mode auto --port 3456 --api-key your-secret-key
```

### 2. Verify Server is Running

```bash
curl http://localhost:3456/v1/health
```

Expected response:

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

---

## OpenAI Function Calling

EnvCP tools are exposed as OpenAI function definitions that can be used with function calling.

### List Available Functions

```bash
curl -H "Authorization: Bearer your-secret-key" \
  http://localhost:3456/v1/functions
```

Response:

```json
{
  "object": "list",
  "data": [
    {
      "name": "envcp_list",
      "description": "List all available environment variable names",
      "parameters": {
        "type": "object",
        "properties": {
          "tags": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Filter by tags"
          }
        }
      }
    },
    {
      "name": "envcp_get",
      "description": "Get an environment variable value",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Variable name" },
          "show_value": { "type": "boolean", "description": "Show actual value (default: masked)" }
        },
        "required": ["name"]
      }
    }
  ]
}
```

### Call a Function Directly

```bash
curl -X POST \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "envcp_get",
    "arguments": {
      "name": "API_KEY",
      "show_value": true
    }
  }' \
  http://localhost:3456/v1/functions/call
```

Response:

```json
{
  "object": "function_result",
  "name": "envcp_get",
  "result": {
    "name": "API_KEY",
    "value": "sk-...",
    "tags": ["openai", "production"],
    "description": "OpenAI API Key"
  }
}
```

---

## Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/health` | GET | Health check and server info |
| `/v1/models` | GET | List available models (compatibility) |
| `/v1/functions` | GET | List all available functions |
| `/v1/functions/call` | POST | Call a single function directly |
| `/v1/tool_calls` | POST | Process multiple tool calls (batch) |
| `/v1/chat/completions` | POST | OpenAI-compatible chat completions |

### GET /v1/models

Returns a mock model list for OpenAI compatibility.

```bash
curl http://localhost:3456/v1/models
```

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

### POST /v1/tool_calls

Process multiple OpenAI tool calls in batch.

```bash
curl -X POST \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_calls": [
      {
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "envcp_get",
          "arguments": "{\"name\": \"API_KEY\"}"
        }
      },
      {
        "id": "call_def456",
        "type": "function",
        "function": {
          "name": "envcp_get",
          "arguments": "{\"name\": \"DATABASE_URL\"}"
        }
      }
    ]
  }' \
  http://localhost:3456/v1/tool_calls
```

Response:

```json
{
  "object": "list",
  "data": [
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"name\":\"API_KEY\",\"value\":\"sk-...\"}"
    },
    {
      "role": "tool",
      "tool_call_id": "call_def456",
      "content": "{\"name\":\"DATABASE_URL\",\"value\":\"postgres://...\"}"
    }
  ]
}
```

### POST /v1/chat/completions

OpenAI-compatible chat completions endpoint with tool support.

```bash
curl -X POST \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "envcp-1.0",
    "messages": [
      {"role": "user", "content": "Get my API key"}
    ]
  }' \
  http://localhost:3456/v1/chat/completions
```

---

## Python Examples

### Using OpenAI SDK

```python
from openai import OpenAI

# Initialize client with EnvCP server
client = OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="your-secret-key"
)

# List available functions
response = client.get("/functions")
functions = response.json()
print(f"Available functions: {[f['name'] for f in functions['data']]}")

# Call a function directly
import requests

result = requests.post(
    "http://localhost:3456/v1/functions/call",
    headers={"Authorization": "Bearer your-secret-key"},
    json={
        "name": "envcp_get",
        "arguments": {"name": "API_KEY", "show_value": True}
    }
).json()

print(f"API Key: {result['result']['value']}")
```

### Function Calling with GPT-4

```python
from openai import OpenAI

# Regular OpenAI client
openai_client = OpenAI(api_key="your-openai-key")

# EnvCP client for tools
envcp_url = "http://localhost:3456/v1"
envcp_key = "your-secret-key"

# Get EnvCP function definitions
import requests
functions_response = requests.get(
    f"{envcp_url}/functions",
    headers={"Authorization": f"Bearer {envcp_key}"}
).json()

tools = [
    {"type": "function", "function": func}
    for func in functions_response["data"]
]

# Chat with function calling
messages = [
    {"role": "user", "content": "What's my OpenAI API key?"}
]

response = openai_client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    tools=tools
)

# Process tool calls
if response.choices[0].message.tool_calls:
    tool_calls = response.choices[0].message.tool_calls
    
    # Execute tools via EnvCP
    tool_messages = []
    for call in tool_calls:
        result = requests.post(
            f"{envcp_url}/functions/call",
            headers={"Authorization": f"Bearer {envcp_key}"},
            json={
                "name": call.function.name,
                "arguments": json.loads(call.function.arguments)
            }
        ).json()
        
        tool_messages.append({
            "role": "tool",
            "tool_call_id": call.id,
            "content": json.dumps(result["result"])
        })
    
    # Continue conversation with results
    messages.append(response.choices[0].message)
    messages.extend(tool_messages)
    
    final_response = openai_client.chat.completions.create(
        model="gpt-4",
        messages=messages
    )
    
    print(final_response.choices[0].message.content)
```

### Async Usage

```python
import asyncio
import aiohttp

async def get_env_var(name: str):
    async with aiohttp.ClientSession() as session:
        async with session.post(
            "http://localhost:3456/v1/functions/call",
            headers={"Authorization": "Bearer your-secret-key"},
            json={"name": "envcp_get", "arguments": {"name": name}}
        ) as response:
            result = await response.json()
            return result["result"]

# Get multiple variables concurrently
async def main():
    results = await asyncio.gather(
        get_env_var("API_KEY"),
        get_env_var("DATABASE_URL"),
        get_env_var("REDIS_URL")
    )
    
    for var in results:
        print(f"{var['name']}: {var['value']}")

asyncio.run(main())
```

---

## Node.js Examples

### Using fetch

```javascript
// Call a function
async function getEnvVar(name) {
  const response = await fetch('http://localhost:3456/v1/functions/call', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer your-secret-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'envcp_get',
      arguments: { name, show_value: true }
    })
  });
  
  const data = await response.json();
  return data.result;
}

// Usage
const apiKey = await getEnvVar('API_KEY');
console.log('API Key:', apiKey.value);
```

### Using OpenAI SDK

```javascript
import OpenAI from 'openai';

// EnvCP client
const envcp = new OpenAI({
  baseURL: 'http://localhost:3456/v1',
  apiKey: 'your-secret-key'
});

// Get functions
const functions = await fetch('http://localhost:3456/v1/functions', {
  headers: { 'Authorization': 'Bearer your-secret-key' }
}).then(r => r.json());

console.log('Available functions:', functions.data);

// Call function
const result = await fetch('http://localhost:3456/v1/functions/call', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-secret-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'envcp_list',
    arguments: {}
  })
}).then(r => r.json());

console.log('Environment variables:', result.result);
```

---

## Authentication

EnvCP OpenAI server supports authentication via API keys.

### Setting API Key

```bash
# Set during server start
envcp serve --mode openai --api-key your-secret-key
```

### Using API Key

Include in requests using `Authorization` header:

```bash
Authorization: Bearer your-secret-key
```

Example:

```bash
curl -H "Authorization: Bearer your-secret-key" \
  http://localhost:3456/v1/functions
```

**Security Note:** Always use HTTPS in production and keep API keys secure.

---

## Error Handling

### Error Response Format

```json
{
  "error": {
    "message": "Error description",
    "type": "error_type"
  }
}
```

### Common Error Types

| Status Code | Error Type | Description |
|-------------|------------|-------------|
| 401 | `invalid_api_key` | Invalid or missing API key |
| 400 | `invalid_request_error` | Invalid request parameters |
| 404 | `not_found` | Endpoint or resource not found |
| 429 | `rate_limit_exceeded` | Too many requests (60/min default) |
| 500 | `internal_error` | Server error |

### Example Error Handling (Python)

```python
import requests

try:
    response = requests.post(
        "http://localhost:3456/v1/functions/call",
        headers={"Authorization": "Bearer your-secret-key"},
        json={"name": "envcp_get", "arguments": {"name": "MISSING_VAR"}}
    )
    response.raise_for_status()
    result = response.json()
    print(result)
except requests.exceptions.HTTPError as e:
    error = e.response.json()
    print(f"Error: {error['error']['message']}")
    print(f"Type: {error['error']['type']}")
```

---

## Advanced Usage

### Rate Limiting

EnvCP includes built-in rate limiting (60 requests per minute by default).

```bash
# Rate limit headers in response
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1234567890
```

### CORS Support

EnvCP supports CORS for web applications:

```javascript
// Browser usage
fetch('http://localhost:3456/v1/functions', {
  headers: {
    'Authorization': 'Bearer your-secret-key'
  }
})
  .then(r => r.json())
  .then(data => console.log(data));
```

### Batch Processing

Process multiple tool calls efficiently:

```python
import requests

# Batch call multiple functions
tool_calls = [
    {
        "id": f"call_{i}",
        "type": "function",
        "function": {
            "name": "envcp_get",
            "arguments": f'{{"name": "{var}"}}'
        }
    }
    for i, var in enumerate(["API_KEY", "DB_URL", "REDIS_URL"])
]

response = requests.post(
    "http://localhost:3456/v1/tool_calls",
    headers={"Authorization": "Bearer your-secret-key"},
    json={"tool_calls": tool_calls}
).json()

for result in response["data"]:
    content = json.loads(result["content"])
    print(f"{content['name']}: {content.get('value', 'N/A')}")
```

---

## Troubleshooting

### Server Not Starting

```bash
# Check if port is already in use
lsof -i :3456

# Try a different port
envcp serve --mode openai --port 3457
```

### Connection Refused

```bash
# Ensure server is running
curl http://localhost:3456/v1/health

# Check firewall settings
# On macOS:
sudo pfctl -sr | grep 3456

# On Linux:
sudo iptables -L | grep 3456
```

### Authentication Errors

```bash
# Verify API key is set correctly
envcp serve --mode openai --api-key test123

# Test with correct key
curl -H "Authorization: Bearer test123" \
  http://localhost:3456/v1/functions
```

### Function Not Found

```bash
# List available functions
curl -H "Authorization: Bearer your-secret-key" \
  http://localhost:3456/v1/functions

# Check function name spelling
# Correct: envcp_get
# Incorrect: get_env, getEnv
```

### Rate Limit Exceeded

If you hit rate limits (60 requests/minute):

```python
import time

# Add delay between requests
for var in variables:
    result = get_env_var(var)
    time.sleep(1.1)  # Wait 1.1 seconds between calls
```

---

## See Also

- [API Reference](API-Reference) - Complete API documentation
- [MCP Integration](MCP-Integration) - Integration with Claude Desktop, Cursor
- [Gemini Integration](Gemini-Integration) - Google AI integration
- [Security Best Practices](Security-Best-Practices) - Security guidelines
- [Troubleshooting](Troubleshooting) - Common issues and solutions

---

**Need help?** Open an issue on [GitHub](https://github.com/fentz26/EnvCP/issues) or contact us at contact@fentz.dev
