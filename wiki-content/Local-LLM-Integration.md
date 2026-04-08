# Local LLM Integration

Complete guide for integrating EnvCP with local LLMs like Ollama, LM Studio, Jan, Open WebUI, and other self-hosted models.

## Table of Contents

- [Overview](#overview)
- [Supported Tools](#supported-tools)
- [Quick Start](#quick-start)
- [Ollama Integration](#ollama-integration)
- [LM Studio Integration](#lm-studio-integration)
- [Jan Integration](#jan-integration)
- [Open WebUI Integration](#open-webui-integration)
- [Custom Integration](#custom-integration)
- [REST API Usage](#rest-api-usage)
- [Troubleshooting](#troubleshooting)

---

## Overview

EnvCP works seamlessly with local LLMs by providing both OpenAI-compatible and REST API endpoints. This allows you to:

- Use EnvCP with any OpenAI-compatible local LLM
- Integrate with tools that support function calling
- Build custom applications with local AI models
- Keep both your AI and secrets completely local and private

**Supported Protocols:**
- OpenAI-compatible API (recommended for most tools)
- REST API (universal HTTP)
- Auto-detect mode (detects protocol automatically)

---

## Supported Tools

| Tool | Protocol | Function Calling | Status |
|------|----------|------------------|--------|
| Ollama | OpenAI / REST | Via OpenAI compatibility | Supported |
| LM Studio | OpenAI / REST | Via OpenAI compatibility | Supported |
| Jan | OpenAI / REST | Via OpenAI compatibility | Supported |
| Open WebUI | REST | Via custom tools | Supported |
| LocalAI | OpenAI / REST | Via OpenAI compatibility | Supported |
| Text Generation WebUI | REST | Via extensions | Supported |
| Llama.cpp | REST | Manual integration | Supported |
| GPT4All | REST | Manual integration | Supported |

---

## Quick Start

### 1. Start EnvCP Server

```bash
# OpenAI-compatible mode (recommended for most tools)
envcp serve --mode openai --port 3456 --api-key your-key

# Or auto-detect mode
envcp serve --mode auto --port 3456 --api-key your-key

# Or REST mode for universal compatibility
envcp serve --mode rest --port 3456 --api-key your-key
```

### 2. Configure Your Local LLM Tool

Point your tool to EnvCP's endpoint:

```
Base URL: http://localhost:3456/v1       (for OpenAI mode)
Base URL: http://localhost:3456/api      (for REST mode)
API Key: your-key
```

### 3. Test Connection

```bash
# Test OpenAI endpoint
curl http://localhost:3456/v1/health

# Test REST endpoint
curl http://localhost:3456/api/health
```

---

## Ollama Integration

[Ollama](https://ollama.ai/) is a popular tool for running local LLMs. EnvCP integrates via OpenAI-compatible API.

### Setup

1. **Install Ollama** (if not already installed):

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# Download from https://ollama.ai/download
```

2. **Start Ollama**:

```bash
ollama serve
```

3. **Start EnvCP**:

```bash
envcp serve --mode openai --port 3456 --api-key ollama-key
```

### Using with Ollama Python Library

```python
import ollama
import requests

# Get EnvCP functions
functions_response = requests.get(
    "http://localhost:3456/v1/functions",
    headers={"Authorization": "Bearer ollama-key"}
).json()

# Convert to Ollama tools format
tools = [
    {
        "type": "function",
        "function": {
            "name": func["name"],
            "description": func["description"],
            "parameters": func["parameters"]
        }
    }
    for func in functions_response["data"]
]

# Chat with function calling
response = ollama.chat(
    model='llama3.1',
    messages=[
        {'role': 'user', 'content': 'Get my API key'}
    ],
    tools=tools
)

# Process tool calls
if response['message'].get('tool_calls'):
    for tool_call in response['message']['tool_calls']:
        # Execute via EnvCP
        result = requests.post(
            "http://localhost:3456/v1/functions/call",
            headers={"Authorization": "Bearer ollama-key"},
            json={
                "name": tool_call['function']['name'],
                "arguments": tool_call['function']['arguments']
            }
        ).json()
        
        print(f"Result: {result['result']}")
```

### Using with Ollama CLI

```bash
# Pull a model with function calling support
ollama pull llama3.1

# Run with custom tool server
ollama run llama3.1 --tool-server http://localhost:3456/v1
```

### Ollama + LangChain

```python
from langchain_community.llms import Ollama
from langchain.tools import Tool
import requests

# EnvCP tool wrapper
def envcp_get_var(name: str) -> str:
    response = requests.post(
        "http://localhost:3456/v1/functions/call",
        headers={"Authorization": "Bearer ollama-key"},
        json={
            "name": "envcp_get",
            "arguments": {"name": name, "show_value": True}
        }
    ).json()
    return response["result"]["value"]

# Create LangChain tool
envcp_tool = Tool(
    name="envcp_get",
    func=envcp_get_var,
    description="Get environment variable value by name"
)

# Use with Ollama
llm = Ollama(model="llama3.1")
tools = [envcp_tool]

# Your agent logic here
```

---

## LM Studio Integration

[LM Studio](https://lmstudio.ai/) provides an OpenAI-compatible local server.

### Setup

1. **Install LM Studio** from https://lmstudio.ai/

2. **Load a Model** in LM Studio (e.g., Llama 3.1, Mistral)

3. **Start LM Studio Server** (in LM Studio: Developer tab → Start Server)

4. **Start EnvCP**:

```bash
envcp serve --mode openai --port 3456 --api-key lmstudio-key
```

### Using with LM Studio's OpenAI Client

```python
from openai import OpenAI

# LM Studio client
lm_studio = OpenAI(
    base_url="http://localhost:1234/v1",
    api_key="lm-studio"
)

# EnvCP client for tools
import requests

# Get EnvCP tools
tools_response = requests.get(
    "http://localhost:3456/v1/functions",
    headers={"Authorization": "Bearer lmstudio-key"}
).json()

tools = [
    {"type": "function", "function": func}
    for func in tools_response["data"]
]

# Chat with function calling
response = lm_studio.chat.completions.create(
    model="local-model",
    messages=[
        {"role": "user", "content": "What's my database URL?"}
    ],
    tools=tools
)

# Process function calls
if response.choices[0].message.tool_calls:
    for tool_call in response.choices[0].message.tool_calls:
        result = requests.post(
            "http://localhost:3456/v1/functions/call",
            headers={"Authorization": "Bearer lmstudio-key"},
            json={
                "name": tool_call.function.name,
                "arguments": json.loads(tool_call.function.arguments)
            }
        ).json()
        
        print(f"Variable: {result['result']}")
```

### Direct HTTP Integration

```bash
# Get available functions
curl http://localhost:3456/v1/functions \
  -H "Authorization: Bearer lmstudio-key"

# Call function
curl -X POST http://localhost:3456/v1/functions/call \
  -H "Authorization: Bearer lmstudio-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "envcp_get",
    "arguments": {"name": "API_KEY"}
  }'
```

---

## Jan Integration

[Jan](https://jan.ai/) is an open-source ChatGPT alternative that runs locally.

### Setup

1. **Install Jan** from https://jan.ai/

2. **Download a Model** (e.g., Llama 3, Mistral, Phi-3)

3. **Start EnvCP**:

```bash
envcp serve --mode openai --port 3456 --api-key jan-key
```

4. **Configure Jan** to use EnvCP as a tool provider:
   - Open Jan Settings
   - Go to Extensions or Tools
   - Add Custom Tool Server: `http://localhost:3456/v1`
   - Set API Key: `jan-key`

### Using Jan's API

```javascript
// Jan uses OpenAI-compatible API
const response = await fetch('http://localhost:1337/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'llama3-8b',
    messages: [
      { role: 'user', content: 'Get my API key from EnvCP' }
    ],
    tools: [/* EnvCP tools from /v1/functions */]
  })
});

// Handle tool calls and execute via EnvCP
const data = await response.json();
// Process tool_calls...
```

---

## Open WebUI Integration

[Open WebUI](https://github.com/open-webui/open-webui) supports custom tools and functions.

### Setup

1. **Install Open WebUI**:

```bash
docker run -d -p 3000:8080 \
  --add-host=host.docker.internal:host-gateway \
  -v open-webui:/app/backend/data \
  --name open-webui \
  ghcr.io/open-webui/open-webui:main
```

2. **Start EnvCP**:

```bash
envcp serve --mode rest --port 3456 --api-key webui-key
```

3. **Configure Open WebUI**:
   - Go to Admin Panel → Settings → Tools
   - Add Custom Tool Endpoint: `http://host.docker.internal:3456/api`
   - Set API Key Header: `X-API-Key: webui-key`

### Custom Function Integration

Create a custom function in Open WebUI:

```python
# In Open WebUI Functions editor
import requests

def get_env_var(name: str) -> str:
    """Get environment variable from EnvCP"""
    response = requests.get(
        f"http://host.docker.internal:3456/api/variables/{name}",
        headers={"X-API-Key": "webui-key"}
    )
    data = response.json()
    return data['data']['value']
```

### Using REST API

```bash
# List variables
curl -H "X-API-Key: webui-key" \
  http://localhost:3456/api/variables

# Get variable
curl -H "X-API-Key: webui-key" \
  "http://localhost:3456/api/variables/API_KEY?show_value=true"

# Set variable
curl -X POST \
  -H "X-API-Key: webui-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "NEW_VAR", "value": "secret"}' \
  http://localhost:3456/api/variables
```

---

## Custom Integration

For tools that don't have built-in function calling support:

### REST API Endpoints

```
GET    /api/health                - Health check
GET    /api/variables             - List variables
GET    /api/variables/:name       - Get variable
POST   /api/variables             - Create variable
PUT    /api/variables/:name       - Update variable
DELETE /api/variables/:name       - Delete variable
POST   /api/sync                  - Sync to .env
GET    /api/tools                 - List available tools
POST   /api/tools/:name           - Call tool by name
```

### Python Example

```python
import requests

class EnvCPClient:
    def __init__(self, base_url="http://localhost:3456", api_key=None):
        self.base_url = base_url
        self.headers = {"X-API-Key": api_key} if api_key else {}
    
    def list_variables(self, tags=None):
        params = {"tags": tags} if tags else {}
        response = requests.get(
            f"{self.base_url}/api/variables",
            headers=self.headers,
            params=params
        )
        return response.json()["data"]
    
    def get_variable(self, name, show_value=False):
        response = requests.get(
            f"{self.base_url}/api/variables/{name}",
            headers=self.headers,
            params={"show_value": show_value}
        )
        return response.json()["data"]
    
    def set_variable(self, name, value, tags=None, description=None):
        response = requests.post(
            f"{self.base_url}/api/variables",
            headers=self.headers,
            json={
                "name": name,
                "value": value,
                "tags": tags,
                "description": description
            }
        )
        return response.json()["data"]
    
    def delete_variable(self, name):
        response = requests.delete(
            f"{self.base_url}/api/variables/{name}",
            headers=self.headers
        )
        return response.json()["data"]

# Usage
client = EnvCPClient(api_key="your-key")

# List all variables
vars = client.list_variables()
print(vars)

# Get specific variable
api_key = client.get_variable("API_KEY", show_value=True)
print(f"API Key: {api_key['value']}")

# Set variable
client.set_variable(
    "NEW_SECRET",
    "secret-value",
    tags=["production"],
    description="Production secret"
)
```

### Node.js Example

```javascript
class EnvCPClient {
  constructor(baseUrl = 'http://localhost:3456', apiKey = null) {
    this.baseUrl = baseUrl;
    this.headers = apiKey ? { 'X-API-Key': apiKey } : {};
  }

  async listVariables(tags = null) {
    const url = new URL(`${this.baseUrl}/api/variables`);
    if (tags) url.searchParams.set('tags', tags.join(','));
    
    const response = await fetch(url, { headers: this.headers });
    const data = await response.json();
    return data.data;
  }

  async getVariable(name, showValue = false) {
    const url = new URL(`${this.baseUrl}/api/variables/${name}`);
    if (showValue) url.searchParams.set('show_value', 'true');
    
    const response = await fetch(url, { headers: this.headers });
    const data = await response.json();
    return data.data;
  }

  async setVariable(name, value, options = {}) {
    const response = await fetch(`${this.baseUrl}/api/variables`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        value,
        tags: options.tags,
        description: options.description
      })
    });
    
    const data = await response.json();
    return data.data;
  }

  async deleteVariable(name) {
    const response = await fetch(`${this.baseUrl}/api/variables/${name}`, {
      method: 'DELETE',
      headers: this.headers
    });
    
    const data = await response.json();
    return data.data;
  }
}

// Usage
const client = new EnvCPClient('http://localhost:3456', 'your-key');

// List variables
const vars = await client.listVariables();
console.log(vars);

// Get variable
const apiKey = await client.getVariable('API_KEY', true);
console.log('API Key:', apiKey.value);

// Set variable
await client.setVariable('NEW_SECRET', 'secret-value', {
  tags: ['production'],
  description: 'Production secret'
});
```

---

## REST API Usage

Complete REST API reference for custom integrations.

### Authentication

```bash
# Use X-API-Key header
curl -H "X-API-Key: your-key" http://localhost:3456/api/variables

# Or Authorization header
curl -H "Authorization: Bearer your-key" http://localhost:3456/api/variables
```

### List Variables

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:3456/api/variables
```

Response:

```json
{
  "success": true,
  "data": {
    "variables": ["API_KEY", "DATABASE_URL", "REDIS_URL"]
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Get Variable

```bash
curl -H "X-API-Key: your-key" \
  "http://localhost:3456/api/variables/API_KEY?show_value=true"
```

Response:

```json
{
  "success": true,
  "data": {
    "name": "API_KEY",
    "value": "sk-...",
    "tags": ["production"],
    "description": "API key"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Create/Update Variable

```bash
curl -X POST \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "NEW_VAR",
    "value": "secret123",
    "tags": ["production"],
    "description": "New secret"
  }' \
  http://localhost:3456/api/variables
```

### Delete Variable

```bash
curl -X DELETE \
  -H "X-API-Key: your-key" \
  http://localhost:3456/api/variables/NEW_VAR
```

### Sync to .env

```bash
curl -X POST \
  -H "X-API-Key: your-key" \
  http://localhost:3456/api/sync
```

---

## Troubleshooting

### Connection Issues

```bash
# Verify EnvCP is running
curl http://localhost:3456/v1/health
curl http://localhost:3456/api/health

# Check if port is in use
lsof -i :3456

# Try different port
envcp serve --mode auto --port 3457
```

### Docker Networking

When running tools in Docker, use `host.docker.internal`:

```bash
# From inside Docker container
curl http://host.docker.internal:3456/api/health
```

Or use host network mode:

```bash
docker run --network host your-image
```

### Authentication Errors

```bash
# Verify API key
envcp serve --mode rest --api-key test123

# Test with correct key
curl -H "X-API-Key: test123" http://localhost:3456/api/health
```

### Function Calling Not Working

```bash
# Verify functions are available
curl -H "X-API-Key: your-key" http://localhost:3456/v1/functions

# Check model supports function calling
# Recommended models: Llama 3.1+, Mistral, Hermes, etc.
```

### CORS Issues (Browser)

EnvCP supports CORS by default. If issues persist:

```javascript
// Verify CORS headers
fetch('http://localhost:3456/api/health')
  .then(r => {
    console.log('CORS headers:', r.headers.get('access-control-allow-origin'));
  });
```

---

## See Also

- [API Reference](API-Reference) - Complete API documentation
- [OpenAI Integration](OpenAI-Integration) - OpenAI function calling
- [REST API Endpoints](CLI-Reference#server-commands) - Server configuration
- [Security Best Practices](Security-Best-Practices) - Security guidelines
- [Troubleshooting](Troubleshooting) - Common issues

---

**Need help?** Open an issue on [GitHub](https://github.com/fentz26/EnvCP/issues) or contact us at contact@fentz.dev
