# Troubleshooting Guide

Solutions to common problems and errors when using EnvCP.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Configuration Issues](#configuration-issues)
- [Session & Authentication](#session--authentication)
- [MCP Integration Issues](#mcp-integration-issues)
- [Server Issues](#server-issues)
- [Variable Access Issues](#variable-access-issues)
- [Sync Issues](#sync-issues)
- [Performance Issues](#performance-issues)
- [Error Messages](#error-messages)

## Installation Issues

### "command not found: envcp"

**Problem**: After installing globally, `envcp` command is not recognized.

**Solutions**:

1. **Check if npm global bin is in PATH**:

```bash
npm config get prefix
```

2. **Add to PATH** (replace with your npm prefix):

```bash
# macOS/Linux
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Or for zsh
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

3. **Use npx instead**:

```bash
npx @fentz26/envcp --version
```

### Permission Denied (EACCES)

**Problem**: `npm install -g` fails with permission errors.

**Solutions**:

**Option 1: Change npm's default directory** (recommended):

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g @fentz26/envcp
```

**Option 2: Use sudo** (not recommended):

```bash
sudo npm install -g @fentz26/envcp
```

**Option 3: Use npx** (no installation needed):

```bash
npx @fentz26/envcp
```

### Node Version Too Old

**Problem**: Error about Node.js version.

**Solution**: Upgrade to Node.js 14+:

```bash
# Check current version
node --version

# macOS (via Homebrew)
brew upgrade node

# Linux (via nvm)
nvm install 18
nvm use 18
nvm alias default 18

# Windows: Download from nodejs.org
```

## Configuration Issues

### "Config file not found"

**Problem**: `envcp.yaml` not found.

**Solution**: Run `envcp init` first:

```bash
envcp init
```

Or specify config path:

```bash
envcp --config /path/to/envcp.yaml list
```

### "Invalid configuration"

**Problem**: Syntax error in `envcp.yaml`.

**Solutions**:

1. **Validate YAML syntax**:

```bash
# Use online validator or yamllint
yamllint envcp.yaml
```

2. **Common YAML mistakes**:

```yaml
# WRONG: Tabs instead of spaces
access:
	allow_ai_read: true

# RIGHT: 2 spaces for indentation
access:
  allow_ai_read: true

# WRONG: Missing quotes for special characters
description: It's broken

# RIGHT: Use quotes
description: "It's working"
```

3. **Reset to defaults**:

```bash
envcp init --force
```

### "Storage path not found"

**Problem**: `.envcp/store.enc` missing.

**Solutions**:

1. **Re-initialize** (will lose existing data):

```bash
envcp init --force
```

2. **Check file permissions**:

```bash
ls -la .envcp/
chmod 700 .envcp
chmod 600 .envcp/store.enc
```

## Session & Authentication

### "Password incorrect"

**Problem**: Wrong password provided.

**Solutions**:

1. **Try again carefully** (passwords are case-sensitive)

2. **Check for password in environment**:

```bash
echo $ENVCP_PASSWORD
```

3. **If password is lost**, you must re-initialize (loses all data):

```bash
# Export if possible with old password
envcp export --format json > backup.json

# Re-initialize
envcp init --force

# Re-import if you had exported
# (You'll need to manually add variables back)
```

**Prevention**: Store password in password manager!

### "Session locked"

**Problem**: Vault is locked and password is required.

**Solutions**:

1. **Unlock the session**:

```bash
envcp unlock
```

2. **Provide password inline**:

```bash
envcp list --password YOUR_PASSWORD
```

3. **Check session status**:

```bash
envcp status
```

### Session Expires Too Quickly

**Problem**: Session keeps expiring.

**Solution**: Increase timeout in `envcp.yaml`:

```yaml
session:
  enabled: true
  timeout: 28800  # 8 hours instead of 30 minutes
  auto_extend: true
  extend_time: 3600  # Extend by 1 hour
```

### Can't Remember if Session is Locked

**Problem**: Not sure if you need to unlock.

**Solution**:

```bash
envcp status
```

Output shows:
- Locked or unlocked
- Time remaining if unlocked
- When session expires

## MCP Integration Issues

### MCP Server Not Showing in Claude Desktop

**Problem**: EnvCP tools don't appear in Claude Desktop.

**Solutions**:

1. **Check config file location**:

```bash
# macOS
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Windows
type %APPDATA%\Claude\claude_desktop_config.json

# Linux
cat ~/.config/Claude/claude_desktop_config.json
```

2. **Validate JSON**:

```bash
# Use jq or online JSON validator
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq .
```

3. **Check for common JSON errors**:

```json
// WRONG: Trailing comma
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"],
    }
  }
}

// RIGHT: No trailing comma
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"]
    }
  }
}
```

4. **Fully restart Claude Desktop**:
   - Quit application completely (not just close window)
   - Reopen

5. **Check MCP server logs** (Claude Desktop):
   - View > Developer > Toggle Developer Tools
   - Check Console for errors

### "Cannot find module @fentz26/envcp"

**Problem**: EnvCP not installed or not found.

**Solutions**:

1. **Install globally**:

```bash
npm install -g @fentz26/envcp
```

2. **Or use npx in config** (downloads on demand):

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

3. **Check installation**:

```bash
envcp --version
npx @fentz26/envcp --version
```

### MCP Tools Return Errors

**Problem**: Tools appear but return errors when used.

**Solutions**:

1. **Check session status**:

```bash
envcp status
```

Unlock if needed:

```bash
envcp unlock
```

2. **Check working directory**:

MCP server runs in directory where Claude Desktop was launched. Make sure:
- You're in correct project directory
- `.envcp/` exists in that directory
- `envcp.yaml` exists

3. **Set working directory in config**:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp"],
      "cwd": "/full/path/to/your/project"
    }
  }
}
```

4. **Check logs**:

```bash
tail -f /your/project/.envcp/logs/envcp.log
```

## Server Issues

### "Port already in use"

**Problem**: Port 3456 is already being used.

**Solutions**:

1. **Use different port**:

```bash
envcp serve --mode rest --port 3457
```

2. **Find and kill process using the port**:

```bash
# macOS/Linux
lsof -i :3456
kill <PID>

# Windows
netstat -ano | findstr :3456
taskkill /PID <PID> /F
```

### "API key required"

**Problem**: HTTP server requires API key but none provided.

**Solution**: Provide API key:

```bash
envcp serve --mode rest --api-key YOUR_SECRET_KEY
```

In requests:

```bash
curl -H "X-API-Key: YOUR_SECRET_KEY" http://localhost:3456/api/variables
```

### "Connection refused"

**Problem**: Can't connect to EnvCP server.

**Solutions**:

1. **Check server is running**:

```bash
# Should show envcp process
ps aux | grep envcp
```

2. **Check host/port**:

```bash
# Server on localhost
envcp serve --mode rest --host 127.0.0.1 --port 3456

# Connect to same host/port
curl http://127.0.0.1:3456/api/health
```

3. **Check firewall** (if accessing from network):

```bash
# macOS
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Linux
sudo ufw status
```

### Server Crashes on Start

**Problem**: Server starts then immediately crashes.

**Solutions**:

1. **Check logs**:

```bash
tail -f .envcp/logs/envcp.log
```

2. **Run with debug logging**:

Edit `envcp.yaml`:

```yaml
logging:
  enabled: true
  level: debug
```

3. **Check for corrupt storage**:

```bash
# Backup first!
cp .envcp/store.enc .envcp/store.enc.backup

# Try to read
envcp list

# If corrupt, may need to re-initialize
```

## Variable Access Issues

### "Variable not found"

**Problem**: Variable exists but can't be retrieved.

**Solutions**:

1. **Check exact name** (case-sensitive):

```bash
envcp list
```

2. **Session may be locked**:

```bash
envcp status
envcp unlock
```

3. **Check storage**:

```bash
ls -la .envcp/store.enc
```

### "Access denied" / "Blacklisted variable"

**Problem**: AI or user blocked from accessing variable.

**Solution**: Check `envcp.yaml` blacklist:

```yaml
access:
  blacklist:
    - "*_SECRET"  # Blocks anything ending with _SECRET
    - "ADMIN_*"   # Blocks anything starting with ADMIN_
```

To allow access, either:
- Rename variable: `envcp add NEW_NAME --value "..."`
- Remove from blacklist in `envcp.yaml`
- Use whitelist instead

### AI Can't Access Any Variables

**Problem**: AI gets access denied for all variables.

**Solutions**:

1. **Check access control settings**:

```yaml
access:
  allow_ai_read: true  # Must be true
  allow_ai_write: false
  allow_ai_active_check: false
```

2. **Check whitelist** (if set, only whitelisted vars accessible):

```yaml
access:
  whitelist: []  # Empty = disabled, all allowed (except blacklisted)
```

3. **Session must be unlocked**:

```bash
envcp unlock
```

## Sync Issues

### ".env file not created"

**Problem**: `envcp sync` runs but `.env` not created.

**Solutions**:

1. **Check sync is enabled**:

```yaml
sync:
  enabled: true  # Must be true
  target: .env
```

2. **Check permissions**:

```bash
ls -la .env
chmod 644 .env
```

3. **Check target path**:

```yaml
sync:
  target: .env  # Relative to project root
  # or
  target: /full/path/to/.env
```

### "Variables missing from .env"

**Problem**: Some variables not in synced `.env` file.

**Solution**: Check exclude patterns:

```yaml
sync:
  exclude:
    - "*_SECRET"  # These won't be synced
    - "*_PRIVATE"
```

Remove patterns to include those variables.

### "Backup file not created"

**Problem**: Sync doesn't create backup.

**Solutions**:

1. **Check backup is enabled**:

```yaml
sync:
  backup: true
  backup_path: .envcp/backups
```

2. **Check backup directory exists**:

```bash
mkdir -p .envcp/backups
```

3. **Check permissions**:

```bash
chmod 755 .envcp/backups
```

## Performance Issues

### Slow Command Execution

**Problem**: Commands take long to execute.

**Causes & Solutions**:

1. **Large number of variables** (100+):
   - This is normal, encryption overhead
   - Consider splitting into multiple EnvCP instances

2. **Slow disk** (network drives, encrypted drives):
   - Move `.envcp/` to faster local disk
   - Update path in `envcp.yaml`

3. **Low memory**:
   - Close other applications
   - Restart computer

### High CPU Usage

**Problem**: EnvCP using lots of CPU.

**Cause**: PBKDF2 key derivation (100,000 iterations by design).

**This is normal** during:
- Unlock
- First access after unlock
- Encryption/decryption operations

**Not normal**: Sustained high CPU when idle.

**Solution**: Check for:
- Runaway processes: `ps aux | grep envcp`
- Multiple servers running: Kill extras

## Error Messages

### "ENOENT: no such file or directory"

**Full error**: `Error: ENOENT: no such file or directory, open '.envcp/store.enc'`

**Cause**: Storage file doesn't exist.

**Solution**:

```bash
envcp init
```

### "EACCES: permission denied"

**Full error**: `Error: EACCES: permission denied, open '.envcp/store.enc'`

**Cause**: No permission to read/write file.

**Solution**:

```bash
chmod 600 .envcp/store.enc
chmod 700 .envcp
```

### "Invalid authentication tag"

**Full error**: `Error: Unsupported state or unable to authenticate data`

**Causes**:
- Corrupt storage file
- Wrong password
- File was manually edited

**Solutions**:

1. **Try correct password**

2. **Restore from backup** (if available):

```bash
cp .envcp/backups/store.enc.backup .envcp/store.enc
```

3. **Re-initialize** (loses data):

```bash
envcp init --force
```

### "Unexpected token in JSON"

**Full error**: `SyntaxError: Unexpected token < in JSON at position 0`

**Cause**: Trying to parse non-JSON response (often HTML error page).

**Solutions**:

1. **Check server is running**:

```bash
curl http://localhost:3456/api/health
```

2. **Check URL is correct**:

```bash
# RIGHT
http://localhost:3456/api/variables

# WRONG (returns HTML)
http://localhost:3456/variables
```

3. **Check API key**:

```bash
curl -H "X-API-Key: YOUR_KEY" http://localhost:3456/api/variables
```

## Getting Help

If you're still stuck:

### 1. Check Logs

```bash
tail -f .envcp/logs/envcp.log
```

Enable debug logging:

```yaml
logging:
  level: debug
```

### 2. Gather Information

When reporting issues, include:
- EnvCP version: `envcp --version`
- Node version: `node --version`
- OS: macOS/Linux/Windows
- Command that failed
- Full error message
- Relevant logs (with secrets removed!)

### 3. Search GitHub Issues

Check if someone else had the same problem:

[https://github.com/fentz26/EnvCP/issues](https://github.com/fentz26/EnvCP/issues)

### 4. Create New Issue

If no existing issue matches:

[https://github.com/fentz26/EnvCP/issues/new](https://github.com/fentz26/EnvCP/issues/new)

Include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- System information
- Logs (with secrets removed)

### 5. Security Issues

For security vulnerabilities, email: **contact@fentz.dev**

**DO NOT** open public issues for security problems.

## Common Workarounds

### Can't unlock? Use password inline

```bash
envcp list --password YOUR_PASSWORD
```

### Can't modify config? Use CLI options

```bash
envcp serve --mode rest --port 3457 --host 0.0.0.0
```

### Can't access variables? Export and re-import

```bash
# Export
envcp export --format json > backup.json

# Re-initialize
envcp init --force

# Re-import (manually, one by one)
envcp add VAR1 --value "..."
envcp add VAR2 --value "..."
```

### Server won't start? Run in foreground

```bash
# Foreground with debug output
envcp serve --mode rest

# Watch for errors
```

## Next Steps

- [CLI Reference](CLI-Reference) - All commands and options
- [Configuration Reference](Configuration-Reference) - All settings
- [Security Best Practices](Security-Best-Practices) - Secure your setup
- [GitHub Issues](https://github.com/fentz26/EnvCP/issues) - Report bugs
