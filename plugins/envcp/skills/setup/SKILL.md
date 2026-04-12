---
name: setup
description: Set up EnvCP — initialize the encrypted vault, configure AI access, and verify the MCP server is working. Use when the user asks to set up EnvCP, "how do I configure envcp", "envcp init", or the MCP server reports no active session.
user-invocable: true
allowed-tools:
  - Bash(envcp *)
  - Bash(npx *)
  - Read
  - Write
---

# /envcp:setup — EnvCP Setup

Guides the user through first-time EnvCP setup so the MCP server can start and Claude can access secrets.

Arguments passed: `$ARGUMENTS`

---

## What to do

### Step 1 — Check if EnvCP is installed

Run:
```bash
envcp --version
```

If not found, install it:
```bash
npm install -g @fentz26/envcp
```

### Step 2 — Check if vault is initialized

Run:
```bash
envcp status
```

If the vault does not exist, initialize it:
```bash
envcp init
```

Walk the user through the init prompts:
- **Password**: choose a strong password (8+ chars). They'll enter this when unlocking.
- **Encryption**: keep enabled (default) for security.
- **AI access**: recommend enabling `allow_ai_read` and `allow_ai_active_check` at minimum. Add `allow_ai_write` only if the user wants Claude to be able to set secrets.

### Step 3 — Unlock the vault

The MCP server needs an active session to start. Run:
```bash
envcp unlock
```

The user enters their password. The session lasts 30 minutes by default.

### Step 4 — Verify MCP is working

The MCP server starts automatically via Claude Code once the session is active. Tell the user:

> The EnvCP MCP server is now configured. Claude Code will start it automatically. You can add secrets with `envcp add NAME VALUE` and Claude will be able to reference them by name.

### Error: "No active session"

If the MCP server reports no active session:
```bash
envcp unlock
```

Then reload MCP servers in Claude Code (Settings → MCP → Restart).

### Error: "Vault not found"

The vault hasn't been initialized in this directory:
```bash
envcp init
```

---

## Quick reference

| Task | Command |
|------|---------|
| Initialize vault | `envcp init` |
| Unlock (start session) | `envcp unlock` |
| Add a secret | `envcp add NAME VALUE` |
| List secrets | `envcp list` |
| Lock vault | `envcp lock` |
| Check status | `envcp status` |
