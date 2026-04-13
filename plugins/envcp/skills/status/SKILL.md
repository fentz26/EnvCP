---
name: status
description: Show EnvCP vault status — session state, variable count, AI access flags, and encryption mode. Use when the user asks "envcp status", "is my vault unlocked", "what secrets does Claude have access to", or wants a quick health check.
user-invocable: true
allowed-tools:
  - Bash(envcp status)
  - Bash(envcp list)
  - Bash(envcp verify)
---

# /envcp:status — Vault Status

Shows a full picture of the EnvCP vault and session state.

Arguments passed: `$ARGUMENTS`

---

## What to do

Run all three commands and summarize the results:

```bash
envcp status
```

```bash
envcp list
```

```bash
envcp verify
```

### Summarize as:

**Session**: locked / unlocked (expires in X min)
**Vault**: encrypted / plaintext — N variables stored
**AI access**: list active flags (`allow_ai_read`, `allow_ai_write`, etc.)
**Backup**: N backup files present

If the session is locked, suggest:
> Run `envcp unlock` to start a session, then reload MCP in Claude Code.

If no variables exist yet:
> Run `envcp add NAME VALUE` to store your first secret.
