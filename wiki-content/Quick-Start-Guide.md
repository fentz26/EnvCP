# Quick Start Guide

Get up and running with EnvCP in 5 minutes.

## Step 1: Install EnvCP

```bash
npm install -g @fentz26/envcp
```

Or use without installing:

```bash
npx @fentz26/envcp
```

## Step 2: Initialize Your Project

Navigate to your project directory and initialize EnvCP:

```bash
cd your-project
envcp init
```

You'll be prompted for:
- **Project name**: A friendly name for your project (default: directory name)
- **Encryption password**: Any password you want (even "1" is fine for testing)

This creates:
- `.envcp/` - Encrypted storage directory
- `envcp.yaml` - Configuration file

**Important**: Add `.envcp/` to your `.gitignore`:

```bash
echo ".envcp/" >> .gitignore
```

## Step 3: Add Your Secrets

Add environment variables and secrets:

```bash
# Interactive mode (prompts for value)
envcp add API_KEY

# With value inline
envcp add API_KEY --value "sk-1234567890abcdef"

# Add multiple variables
envcp add DATABASE_URL --value "postgres://user:pass@localhost/db"
envcp add STRIPE_KEY --value "sk_test_..."
envcp add OPENAI_API_KEY --value "sk-..."
```

## Step 4: Verify Your Setup

List your variables (names only, values hidden):

```bash
envcp list
```

Get a specific variable:

```bash
envcp get API_KEY
```

Check session status:

```bash
envcp status
```

## Step 5: Start the Server

### For MCP Clients (Claude, Cursor, Cline)

```bash
envcp serve --mode mcp
```

Then configure your MCP client (see [MCP Integration](MCP-Integration)).

### For HTTP Clients (ChatGPT, Gemini, Local LLMs)

```bash
envcp serve --mode auto --port 3456 --api-key your-secret-key
```

The `auto` mode automatically detects the client type from request headers.

### For Multiple Clients

```bash
envcp serve --mode all --port 3456 --api-key your-secret-key
```

This enables all HTTP protocols on the same port.

## Common Workflows

### Sync to .env File

Keep your `.env` file in sync with EnvCP:

```bash
envcp sync
```

This creates/updates your `.env` file with all variables (respecting exclusions in config).

### Run Commands with Environment Variables

Export variables into a local `.env` file for tools that already know how to read dotenv files:

```bash
envcp sync
envcp export --format env > .env
```

### Session Management

Unlock once and work without re-entering password:

```bash
# Unlock (default: 30 minutes)
envcp unlock

# Check status
envcp status

# Extend session
envcp extend

# Lock immediately
envcp lock
```

### Export Variables

Export your variables to different formats:

```bash
# .env format
envcp export --format env

# JSON format
envcp export --format json > backup.json

# YAML format
envcp export --format yaml
```

## Example: Setting Up with Claude Desktop

1. **Install and initialize EnvCP**:

```bash
npm install -g @fentz26/envcp
cd your-project
envcp init
```

2. **Add your secrets**:

```bash
envcp add OPENAI_API_KEY --value "sk-..."
envcp add DATABASE_URL --value "postgres://..."
```

3. **Configure Claude Desktop**:

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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

4. **Restart Claude Desktop**

5. **Test in Claude**:

```
Can you check what environment variables are available in EnvCP?
```

Claude will use the `envcp_list` tool to show variable names.

## Example: Setting Up with ChatGPT API

1. **Start the server**:

```bash
envcp serve --mode openai --port 3456 --api-key my-secret-key
```

2. **Use in your Python code**:

```python
import openai
import requests

# Configure OpenAI to use EnvCP function calling endpoint
client = openai.OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="my-secret-key"
)

# Get available tools
tools = requests.get(
    "http://localhost:3456/v1/tools",
    headers={"Authorization": "Bearer my-secret-key"}
).json()

# Call a function
result = requests.post(
    "http://localhost:3456/v1/functions/call",
    headers={"Authorization": "Bearer my-secret-key"},
    json={
        "name": "envcp_get",
        "arguments": {"name": "OPENAI_API_KEY"}
    }
).json()

print(result)
```

## Example: Local Development Workflow

```bash
# Morning: unlock your vault
envcp unlock

# Work on your project - AI can access variables as needed
# ... coding ...

# Need to add a new API key?
envcp add NEW_API_KEY --value "..."

# Update your .env file
envcp sync

# Extend your session if needed
envcp extend

# End of day: lock your vault
envcp lock
```

## Next Steps

Now that you're up and running:

- **Configure access control**: [AI Access Control](AI-Access-Control)
- **Secure your setup**: [Security Best Practices](Security-Best-Practices)
- **Integrate with your platform**: [MCP Integration](MCP-Integration) | [OpenAI Integration](OpenAI-Integration) | [Gemini Integration](Gemini-Integration)
- **Learn all commands**: [CLI Reference](CLI-Reference)
- **Customize settings**: [Configuration Reference](Configuration-Reference)

## Common Issues

### "Password incorrect" error

Make sure you're using the same password you set during `envcp init`. If you forgot it, you'll need to re-initialize (which will erase existing data).

### Variables not syncing to .env

Check your `envcp.yaml` configuration:
```yaml
sync:
  enabled: true
  target: .env
```

### AI can't access variables

1. Check session is unlocked: `envcp status`
2. Check access control settings in `envcp.yaml`
3. Verify server is running: `envcp serve`

For more help, see the [Troubleshooting Guide](Troubleshooting).
