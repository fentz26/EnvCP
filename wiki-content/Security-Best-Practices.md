# Security Best Practices

Essential security practices for using EnvCP safely and effectively.

## Core Security Principles

### 1. Never Commit Secrets

Always add `.envcp/` to your `.gitignore`:

```bash
# .gitignore
.envcp/
*.enc
```

Verify it's ignored:

```bash
git status --ignored
```

### 2. Use Strong Encryption Passwords

While EnvCP allows any password (even "1" for convenience), use strong passwords for production:

**Good password practices**:
- At least 12 characters
- Mix of uppercase, lowercase, numbers, symbols
- Not based on dictionary words
- Unique to this project

**In `envcp.yaml`**:

```yaml
password:
  min_length: 12
  require_uppercase: true
  require_lowercase: true
  require_numbers: true
  require_special: true
```

### 3. Restrict AI Access

Limit what AI can see and do:

```yaml
access:
  # AI can read when asked
  allow_ai_read: true
  
  # AI cannot modify secrets
  allow_ai_write: false
  
  # AI cannot proactively list secrets
  allow_ai_active_check: false
  
  # Require confirmation before providing values
  require_confirmation: true
```

### 4. Use Blacklist Patterns

Block sensitive variables from AI access:

```yaml
access:
  blacklist:
    - "*_SECRET"
    - "*_PRIVATE"
    - "*_KEY"
    - "ADMIN_*"
    - "ROOT_*"
    - "MASTER_*"
    - "*PASSWORD*"
    - "*TOKEN*"
    - "PROD_*"
    - "PRODUCTION_*"
```

### 5. Use Session Timeouts

Don't stay unlocked indefinitely:

```yaml
session:
  enabled: true
  timeout: 1800  # 30 minutes
  auto_extend: true
  extend_time: 900  # Extend by 15 minutes on activity
```

## Password Management

### Storing Passwords Securely

**DON'T**:
- Hardcode passwords in config files
- Store passwords in version control
- Share passwords in chat logs
- Use the same password across projects

**DO**:
- Use a password manager (1Password, Bitwarden, etc.)
- Use environment variables for CI/CD
- Use different passwords per environment
- Rotate passwords regularly

### Password in MCP Configuration

If you add password to MCP config for auto-unlock:

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["@fentz26/envcp", "serve", "--mode", "mcp", "--password", "mysecret"]
    }
  }
}
```

**Risks**:
- Password is in plain text
- Anyone with access to your machine can see it

**Mitigations**:
- Only use on personal, secure machines
- Use file permissions to restrict access
- Consider manual unlock instead

**File permissions (macOS/Linux)**:

```bash
chmod 600 ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

### Environment Variables for Passwords

For scripts and CI/CD:

```bash
# .bashrc or .zshrc
export ENVCP_PASSWORD="your-secret-password"

# Use in commands
envcp list  # Automatically uses $ENVCP_PASSWORD
```

**Important**: Don't commit this to version control.

## API Key Security

When running HTTP servers, always use API keys:

```bash
# Generate a strong random key
openssl rand -base64 32

# Use it
envcp serve --mode rest --api-key "your-generated-key"
```

**Store API keys securely**:

```bash
# In environment variable
export ENVCP_API_KEY="your-generated-key"
envcp serve --mode rest --api-key "$ENVCP_API_KEY"
```

### Network Security

**Localhost only (default)**:

```bash
envcp serve --mode rest --host 127.0.0.1
```

This prevents network access from other machines.

**Network access (use carefully)**:

```bash
envcp serve --mode rest --host 0.0.0.0
```

Only do this if:
- You're in a trusted network
- You're using strong API keys
- You understand the risks

**Better**: Use SSH tunneling for remote access:

```bash
# On remote machine
envcp serve --mode rest --host 127.0.0.1 --port 3456

# On local machine
ssh -L 3456:localhost:3456 user@remote-machine
```

## Access Control Strategies

### Read-Only AI Access

For maximum security, make AI read-only:

```yaml
access:
  allow_ai_read: true
  allow_ai_write: false
  allow_ai_active_check: false
  require_confirmation: true
```

AI can get variables when you explicitly ask, but cannot:
- Create new variables
- Update existing variables
- Delete variables
- List all variables unprompted

### Whitelist-Only Access

For critical projects, use whitelist mode:

```yaml
access:
  whitelist:
    - "PUBLIC_API_KEY"
    - "DEV_DATABASE_URL"
    - "STAGING_*"
  
  # Blacklist is ignored when whitelist is set
  blacklist: []
```

Only whitelisted patterns are accessible. Everything else is blocked.

### Environment-Based Access

Different access for different environments:

**Development (`envcp.dev.yaml`)**:

```yaml
access:
  allow_ai_write: true
  allow_ai_active_check: false
  blacklist:
    - "*_PROD_*"
    - "*_PRODUCTION_*"
```

**Production (`envcp.prod.yaml`)**:

```yaml
access:
  allow_ai_write: false
  allow_ai_active_check: false
  require_confirmation: true
  blacklist:
    - "*_SECRET"
    - "*_PRIVATE"
    - "*_KEY"
    - "ADMIN_*"
```

Use the appropriate config:

```bash
# Development
envcp --config envcp.dev.yaml serve

# Production
envcp --config envcp.prod.yaml serve
```

## Sync Security

### Selective Sync

Don't sync everything to .env:

```yaml
sync:
  enabled: true
  target: .env.local
  exclude:
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"
    - "PROD_*"
```

### Backup Protection

Always backup before overwriting:

```yaml
sync:
  enabled: true
  backup: true
  backup_path: .envcp/backups
```

Backups are timestamped:

```
.envcp/backups/
├── .env.backup.20260408_120000
├── .env.backup.20260408_130000
└── .env.backup.20260408_140000
```

### .env File Security

Even synced .env files should be secure:

```bash
# .gitignore
.env
.env.local
.env.*.local
```

File permissions:

```bash
chmod 600 .env
```

## Logging Security

### What Gets Logged

EnvCP logs:
- Command executions
- Variable access attempts
- Session events
- Errors

EnvCP **never** logs:
- Actual variable values
- Passwords
- Decrypted content

### Log Location

```
.envcp/logs/
├── envcp.log
├── envcp.log.1
└── envcp.log.2
```

### Log Configuration

```yaml
logging:
  enabled: true
  level: info  # Use 'error' in production
  max_size: 10485760  # 10MB
  max_files: 5
```

**For production**:

```yaml
logging:
  level: error  # Only log errors, less verbose
  max_files: 3  # Keep fewer logs
```

### Reviewing Logs

Regularly check logs for suspicious activity:

```bash
# View recent logs
tail -f .envcp/logs/envcp.log

# Search for access attempts
grep "access" .envcp/logs/envcp.log

# Search for errors
grep "ERROR" .envcp/logs/envcp.log
```

## Encryption Details

### Algorithm

EnvCP uses **AES-256-GCM** with:
- **Key derivation**: PBKDF2-SHA512 (100,000 iterations)
- **Salt**: 64 bytes (random per encryption)
- **IV**: 16 bytes (random per encryption)
- **Auth tag**: 16 bytes (for integrity verification)

This is the same encryption used by:
- 1Password
- Bitwarden
- LastPass
- Military and government systems

### What's Encrypted

- ✓ Variable values
- ✓ Variable descriptions
- ✓ Metadata
- ✓ Everything in `.envcp/store.enc`

### What's Not Encrypted

- Variable names (needed for lookups)
- Configuration in `envcp.yaml`
- Logs

**Implication**: Even variable names can leak information. Use generic names for highly sensitive data:

```bash
# Instead of
envcp add BITCOIN_WALLET_PRIVATE_KEY

# Consider
envcp add KEY_001
```

## Multi-User Scenarios

### Personal Machine

Full access, convenience features enabled:

```yaml
session:
  timeout: 28800  # 8 hours
  auto_extend: true

access:
  allow_ai_write: true
  require_confirmation: false
```

### Shared Development Machine

Restricted access, shorter sessions:

```yaml
session:
  timeout: 1800  # 30 minutes
  auto_extend: false

access:
  allow_ai_write: false
  require_confirmation: true
  blacklist:
    - "*_PROD_*"
    - "*_SECRET"
```

Lock when stepping away:

```bash
envcp lock
```

### CI/CD Environment

Minimal logging, programmatic access:

```yaml
session:
  enabled: false  # No session, password every time

access:
  allow_ai_read: false  # No AI in CI
  allow_ai_write: false

logging:
  level: error  # Minimal logging
```

Use environment variables:

```bash
export ENVCP_PASSWORD="$CI_ENVCP_PASSWORD"
envcp export --format env > .env
```

## Incident Response

### If Password is Compromised

1. **Immediately lock the vault**:

```bash
envcp lock
```

2. **Change the password** (requires re-encryption):

```bash
# Export current values
envcp export --format json > backup.json

# Re-initialize with new password
envcp init --force

# Re-import values
cat backup.json | jq -r 'to_entries[] | "envcp add \(.key) --value \"\(.value)\""' | bash

# Delete backup
shred -u backup.json  # Linux
rm -P backup.json      # macOS
```

3. **Rotate all secrets**:

```bash
# List all variables
envcp list

# Update each with new values from their providers
envcp add API_KEY --value "new-value"
```

### If .envcp/ is Committed

1. **Remove from git history**:

```bash
# Remove from all commits
git filter-branch --force --index-filter \
  "git rm -rf --cached --ignore-unmatch .envcp/" \
  --prune-empty --tag-name-filter cat -- --all

# Force push (coordinate with team!)
git push origin --force --all
```

2. **Rotate all secrets** (they may have been exposed)

3. **Add to .gitignore**:

```bash
echo ".envcp/" >> .gitignore
git add .gitignore
git commit -m "Add .envcp/ to gitignore"
```

### If API Key is Leaked

1. **Immediately stop the server**:

```bash
# Find the process
ps aux | grep envcp

# Kill it
kill <PID>
```

2. **Generate new API key**:

```bash
openssl rand -base64 32
```

3. **Update all clients** with new key

4. **Check logs** for unauthorized access:

```bash
grep "unauthorized" .envcp/logs/envcp.log
```

## Security Checklist

Use this checklist for each project:

- [ ] `.envcp/` added to `.gitignore`
- [ ] Strong password set (12+ characters for production)
- [ ] Session timeout configured appropriately
- [ ] AI write access disabled (`allow_ai_write: false`)
- [ ] AI active check disabled (`allow_ai_active_check: false`)
- [ ] Blacklist patterns configured
- [ ] Sync excludes sensitive patterns
- [ ] API key set for HTTP modes
- [ ] Server bound to localhost (unless network access needed)
- [ ] Logs reviewed regularly
- [ ] Backup strategy in place
- [ ] Password stored in password manager
- [ ] Team members trained on security practices

## References

- [Configuration Reference](Configuration-Reference) - All security settings
- [AI Access Control](AI-Access-Control) - Controlling AI access
- [Session Management](Session-Management) - Session security
- [Troubleshooting](Troubleshooting) - Security-related issues

## Reporting Security Issues

If you discover a security vulnerability in EnvCP:

**DO NOT** open a public GitHub issue.

Instead, email: **contact@fentz.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We'll respond within 48 hours and work with you to address the issue.
