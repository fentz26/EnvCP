# MCP Integration Guide

Complete guide for integrating EnvCP with MCP (Model Context Protocol) clients like Claude Desktop, Cursor, and Cline.

## What is MCP?

The Model Context Protocol (MCP) is Anthropic's standard for connecting AI assistants to external data sources and tools. EnvCP implements MCP to provide secure environment variable management directly within your AI workflow.

## Supported MCP Clients

- **Claude Desktop** - Anthropic's desktop app
- **Claude Code** - Code-focused Claude interface
- **Cursor** - AI-powered code editor
- **Cline** (formerly Claude Dev) - VS Code extension
- **Continue.dev** - VS Code/JetBrains extension
- **Zed** - Modern code editor with AI

## Quick Setup

### 1. Install EnvCP

```bash
npm install -g @fentz26/envcp
```

### 2. Initialize in Your Project

```bash
cd your-project
envcp init
envcp add API_KEY --value "your-secret-key"
```

### 3. Configure Your MCP Client

Add EnvCP to your MCP configuration file (see client-specific instructions below).

### 4. Restart Your Client

Restart Claude Desktop, Cursor, or your IDE to load the new MCP server.

## Client-Specific Setup

### Claude Desktop

**macOS** configuration file:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows** configuration file:
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux** configuration file:
```
~/.config/Claude/claude_desktop_config.json
```

**Configuration**:

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

**With custom password** (unlock on start):

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": [
        "@fentz26/envcp",
        "serve",
        "--mode", "mcp",
        "--password", "your-password"
      ]
    }
  }
}
```

**Alternative: Use global installation**:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "envcp",
      "args": ["serve", "--mode", "mcp"]
    }
  }
}
```

**Restart Claude Desktop** and you should see EnvCP tools available.

### Cursor

Cursor uses the same MCP configuration as Claude Desktop.

**Configuration file**:
```
~/.cursor/mcp_config.json
```

**Configuration**:

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

**Restart Cursor** to load the MCP server.

### Cline (VS Code Extension)

Cline reads MCP configuration from VS Code settings.

**Open VS Code Settings** (JSON):
- Press `Cmd/Ctrl + Shift + P`
- Type "Preferences: Open User Settings (JSON)"

**Add to settings.json**:

```json
{
  "cline.mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"]
    }
  }
}
```

**Reload VS Code window** or restart Cline extension.

### Continue.dev

Continue.dev supports MCP servers through its configuration.

**Configuration file**:
```
~/.continue/config.json
```

**Configuration**:

```json
{
  "mcpServers": [
    {
      "name": "envcp",
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"]
    }
  ]
}
```

### Zed Editor

Zed supports MCP through its settings.

**Configuration file**:
```
~/.config/zed/settings.json
```

**Configuration**:

```json
{
  "mcp": {
    "servers": {
      "envcp": {
        "command": "npx",
        "args": ["@fentz26/envcp", "serve", "--mode", "mcp"]
      }
    }
  }
}
```

## Available MCP Tools

Once configured, your AI client has access to these EnvCP tools:

### envcp_list

List all environment variable names (values are hidden).

**Example prompts**:
- "What environment variables are in EnvCP?"
- "List all my env vars"
- "Show me what secrets I have stored"

**Parameters**: None

**Returns**: Array of variable names

### envcp_get

Get a specific environment variable value.

**Example prompts**:
- "Get my API_KEY from EnvCP"
- "What's the value of DATABASE_URL?"
- "Show me my OPENAI_API_KEY"

**Parameters**:
- `name` (string, required): Variable name
- `mask` (boolean, optional): Whether to mask the value (default: true)

**Returns**: Variable value (masked or unmasked based on settings)

### envcp_set

Create or update an environment variable.

**Example prompts**:
- "Add a new API key called STRIPE_KEY with value sk_test_123"
- "Update DATABASE_URL to postgres://localhost/mydb"
- "Set OPENAI_API_KEY to sk-..."

**Parameters**:
- `name` (string, required): Variable name
- `value` (string, required): Variable value
- `description` (string, optional): Variable description

**Returns**: Success confirmation

**Note**: This requires `allow_ai_write: true` in your configuration.

### envcp_delete

Delete an environment variable.

**Example prompts**:
- "Delete the OLD_API_KEY variable"
- "Remove TEMP_TOKEN from EnvCP"

**Parameters**:
- `name` (string, required): Variable name

**Returns**: Success confirmation

**Note**: This requires `allow_ai_write: true` in your configuration.

### envcp_sync

Sync variables to .env file.

**Example prompts**:
- "Sync my environment variables to .env"
- "Update my .env file with EnvCP values"

**Parameters**: None

**Returns**: Success confirmation with file path

### envcp_run

Run a command with environment variables injected.

**Example prompts**:
- "Run npm test with my environment variables"
- "Execute 'node server.js' with EnvCP env vars"

**Parameters**:
- `command` (string, required): Command to run

**Returns**: Command output

### envcp_check_access

Check if a variable is accessible to AI.

**Example prompts**:
- "Can you access ADMIN_PASSWORD?"
- "Is STRIPE_SECRET_KEY available?"

**Parameters**:
- `name` (string, required): Variable name

**Returns**: Access status and reason

## Usage Examples

### Example Conversation

**You**: "Can you list what environment variables I have in EnvCP?"

**Claude**: *Uses envcp_list tool*

"You have the following environment variables in EnvCP:
- API_KEY
- DATABASE_URL
- STRIPE_KEY
- OPENAI_API_KEY"

---

**You**: "Get my API_KEY"

**Claude**: *Uses envcp_get tool*

"Your API_KEY is: sk-1234...cdef (showing first/last characters)"

---

**You**: "Add a new variable called SENDGRID_KEY with value sg_..."

**Claude**: *Uses envcp_set tool*

"I've added SENDGRID_KEY to EnvCP successfully."

---

**You**: "Sync these to my .env file"

**Claude**: *Uses envcp_sync tool*

"I've synced all variables to .env file at /your/project/.env"

## Advanced Configuration

### Project-Specific Setup

Configure EnvCP to work in a specific project directory:

```json
{
  "mcpServers": {
    "envcp-myproject": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Multiple Projects

Set up separate EnvCP instances for different projects:

```json
{
  "mcpServers": {
    "envcp-project-a": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"],
      "cwd": "/path/to/project-a"
    },
    "envcp-project-b": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"],
      "cwd": "/path/to/project-b"
    }
  }
}
```

### Custom Configuration File

Use a custom configuration file:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": [
        "@fentz26/envcp",
        "serve",
        "--mode", "mcp",
        "--config", "envcp.prod.yaml"
      ]
    }
  }
}
```

## Session Management

### Unlock on Server Start

Auto-unlock when MCP server starts:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": [
        "@fentz26/envcp",
        "serve",
        "--mode", "mcp",
        "--password", "your-password"
      ]
    }
  }
}
```

**Security note**: Your password will be in plain text in the config file. Only use this on secure, personal machines.

### Manual Unlock

Unlock manually before using MCP:

```bash
# In terminal
envcp unlock

# Then use Claude Desktop/Cursor normally
```

## Access Control

Control what AI can do with your variables in `envcp.yaml`:

```yaml
access:
  # AI can read variables when you ask
  allow_ai_read: true
  
  # AI cannot create/update variables
  allow_ai_write: false
  
  # AI cannot proactively list variables
  allow_ai_active_check: false
  
  # Require confirmation before providing values
  require_confirmation: true
  
  # Block sensitive patterns
  blacklist:
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"
```

## Troubleshooting

### MCP Server Not Showing Up

1. **Check configuration file path**
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Make sure the JSON is valid (use a JSON validator)

2. **Verify EnvCP is installed**
   ```bash
   envcp --version
   npx @fentz26/envcp --version
   ```

3. **Check MCP server logs**
   - Look in Claude Desktop logs
   - Check `.envcp/logs/` in your project

4. **Restart the client completely**
   - Fully quit and reopen Claude Desktop/Cursor
   - Don't just close the window

### "Cannot find module" Error

If you see module errors:

```bash
# Global installation
npm install -g @fentz26/envcp

# Or use npx (recommended)
npx @fentz26/envcp serve --mode mcp
```

### Session Locked

If you get "Session locked" errors:

```bash
# Unlock in terminal
envcp unlock

# Or pass password in config (less secure)
```

### Permission Denied

On Linux/macOS, if you get permission errors:

```bash
# Fix npm permissions
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules
```

### Tools Not Working

1. **Check access control**: Review `envcp.yaml` settings
2. **Check session status**: Run `envcp status`
3. **Check logs**: Look in `.envcp/logs/`
4. **Try direct CLI**: Test with `envcp list` to verify setup

## Best Practices

1. **Don't commit passwords** - Keep passwords out of MCP config if possible
2. **Use session management** - Unlock once, work all day
3. **Set access controls** - Limit what AI can do (disable writes, active checks)
4. **Use blacklist patterns** - Protect sensitive variables
5. **Check logs regularly** - Monitor what AI is accessing

## Next Steps

- [AI Access Control](AI-Access-Control) - Fine-tune AI permissions
- [Session Management](Session-Management) - Manage unlock sessions
- [Security Best Practices](Security-Best-Practices) - Secure your setup
- [Troubleshooting](Troubleshooting) - Solve common issues
