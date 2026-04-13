# EnvCP Security Guide

← [README](../README.md) · [Setup Guide](../SETUP.md) · [Security Policy](../SECURITY.md) · [Threat Model](THREAT_MODEL.md)

Best practices for deploying EnvCP securely, and incident response runbooks for common compromise scenarios.

---

## Table of Contents

- [Password Strength](#password-strength)
- [Network Exposure](#network-exposure)
- [Session Management](#session-management)
- [Audit Log Review](#audit-log-review)
- [AI Access Control](#ai-access-control)
- [Vault Hygiene](#vault-hygiene)
- [Incident Response](#incident-response)
  - [store.enc stolen](#scenario-1--storeenc-stolen)
  - [Session compromised](#scenario-2--session-compromised)
  - [API key leaked](#scenario-3--api-key-leaked)
  - [Vault password compromised](#scenario-4--vault-password-compromised)
  - [Malicious variable access detected in logs](#scenario-5--malicious-variable-access-detected-in-logs)

---

## Password Strength

Your vault password is the single most important control. Argon2id (64 MB, 3 passes) makes brute-force expensive, but a weak password still falls quickly.

**Minimum bar:**

| Length | Character types | Verdict |
|--------|----------------|---------|
| < 8 | any | Rejected by EnvCP |
| 8–11 | single type | Weak — EnvCP warns |
| 12+ | mixed (upper, lower, number, symbol) | Recommended |
| 20+ | random passphrase | Strong |

**Rules EnvCP enforces:**
- Rejects the top 35 most-common passwords (e.g. `password`, `admin123`)
- Rejects numeric-only passwords by default
- Warns if < 12 characters or single character class

**Tips:**
- Use a passphrase of 4+ random words (`correct-horse-battery-staple`)
- Never reuse your vault password as another account password
- Store the vault password in a hardware-backed password manager, not a plaintext file
- Use `envcp init --password` only in a private terminal — avoid command-line arguments when possible (they appear in shell history and `ps` output)

**Recovery key:**

```bash
envcp init        # Recovery key is shown once at init
```

Store the recovery key in a separate secure location (e.g. printed, offline). It is the only way to recover your vault if you forget the master password.

---

## Network Exposure

EnvCP's HTTP modes (REST, OpenAI, Gemini) bind to `127.0.0.1:3456` by default. This is correct for single-user local development.

**Do not expose the port externally without:**

1. An `api_key` configured in `.envcp/config.yaml`
2. A TLS-terminating reverse proxy (nginx, Caddy) in front
3. Firewall rules restricting access to trusted IPs

**Recommended config for any non-loopback use:**

```yaml
server:
  host: 127.0.0.1      # Never 0.0.0.0 unless behind a proxy
  port: 3456
  api_key: "<random-32-char-string>"
  allowed_origin: "http://localhost:3456"
```

**MCP stdio mode** has no network exposure — it communicates via stdin/stdout with the spawning process. Prefer `--mode mcp` when your AI client supports it.

**Shared / multi-user machines:**

- The `.envcp/` directory and `store.enc` are `0o600` — readable only by the owner
- Do not run `envcp serve` as root
- Consider a dedicated OS user account for the envcp process
- On shared hosts, treat any other user with root access as having potential access to your decrypted secrets while the session is active (see [Threat Model — Information Disclosure](THREAT_MODEL.md#i--information-disclosure))

---

## Session Management

A session is created when you run `envcp unlock` and expires after `timeout_minutes` (default: 30). During an active session, the vault password is held in process memory.

**Recommended settings for sensitive environments:**

```yaml
session:
  timeout_minutes: 15       # Lock after 15 min idle
  max_extensions: 2         # Limit re-unlocks before requiring full password
```

**Best practices:**

- Run `envcp lock` explicitly when stepping away from your machine
- Do not set `timeout_minutes: 0` (no timeout) in production or on shared machines
- Check session status with `envcp status` — it shows remaining time
- If you leave your machine unlocked with an active session, anyone with physical or remote access can query your vault

**Lockout protection:**

After 5 failed unlock attempts, EnvCP imposes a lockout with exponential backoff (60s, 120s, 240s, …). This persists across process restarts. If you are locked out legitimately:

```bash
envcp unlock --recovery   # Use recovery key to reset
```

---

## Audit Log Review

EnvCP writes per-day audit logs to `.envcp/logs/operations-YYYY-MM-DD.log`. Each line is a JSON record.

**What is logged:**
- Every `envcp_get`, `envcp_set`, `envcp_delete`, `envcp_run` call
- Auth failures (401) with the caller's IP address
- Operation source (`cli`, `api`, `mcp`)
- Success or failure

**What is NOT logged:**
- Variable values (never)
- Passwords

**Reviewing logs:**

```bash
# All operations today
cat .envcp/logs/operations-$(date +%F).log | jq .

# Auth failures only
cat .envcp/logs/operations-*.log | jq 'select(.operation == "auth_failure")'

# All gets on a specific variable
cat .envcp/logs/operations-*.log | jq 'select(.variable == "STRIPE_SECRET")'

# Failed operations
cat .envcp/logs/operations-*.log | jq 'select(.success == false)'
```

**What to look for:**
- Repeated `auth_failure` from an unexpected IP — possible API key brute-force
- `envcp_get` on blacklisted variables that still returned success — config mismatch
- `envcp_run` calls with unexpected commands — potential AI agent abuse
- Gaps in the log during expected working hours — possible log tampering

**Log retention:**

Logs are pruned after 30 days by default. To change:

```yaml
audit:
  retain_days: 90
```

---

## AI Access Control

By default, EnvCP allows AI agents to read variables but not proactively list them. Review these settings for each deployment:

| Config flag | Default | Effect |
|-------------|---------|--------|
| `allow_ai_read` | `true` | AI can call `envcp_get` |
| `allow_ai_write` | `false` | AI can call `envcp_set` |
| `allow_ai_delete` | `false` | AI can call `envcp_delete` |
| `allow_ai_execute` | `false` | AI can call `envcp_run` |
| `allow_ai_active_check` | `false` | AI can call `envcp_list` proactively |
| `mask_values` | `true` | Values are masked before returning to AI |

**Recommended minimal config (read-only, no listing):**

```yaml
access:
  allow_ai_read: true
  allow_ai_write: false
  allow_ai_delete: false
  allow_ai_execute: false
  allow_ai_active_check: false
  mask_values: true
  blacklist_patterns:
    - "*_SECRET"
    - "*_PRIVATE"
    - "*_PASSWORD"
    - "RECOVERY_*"
    - "ADMIN_*"
```

**If you enable `allow_ai_execute`:**
- You MUST set an `api_key` — EnvCP refuses to start without one
- Review `disallow_commands` to block `curl`, `wget`, `nc`, and other egress tools
- Be aware that command output is returned to the AI — avoid commands that print secret values

**Per-variable protection for the most sensitive secrets:**

```bash
envcp add PROD_DB_PASSWORD --value "..." --protect
# AI must provide the per-variable password to access this — even with allow_ai_read: true
```

---

## Vault Hygiene

- **Never commit `.envcp/` to git.** It should be in `.gitignore` (EnvCP adds it automatically at `init`).
- **Export backups regularly** to an encrypted external location:
  ```bash
  envcp export --format json > backup-$(date +%F).json
  # Encrypt the backup before storing
  gpg --symmetric backup-$(date +%F).json
  ```
- **Rotate the vault password** if you suspect it was exposed:
  ```bash
  envcp change-password
  ```
- **Rotate variable values** (not just the vault password) if a secret is compromised — the vault password protects the file at rest, but the variable value itself must be rotated at the service level.
- Keep EnvCP updated: `npm update -g @fentz26/envcp`

---

## Incident Response

### Scenario 1 — `store.enc` stolen

**Symptoms:** You believe someone has copied `.envcp/store.enc` from your machine.

**Severity:** High if your vault password is weak; Low-Medium if password is strong (Argon2id makes brute-force very expensive).

**Steps:**

1. **Assess password strength.** If your password is 12+ characters, mixed types, and not a dictionary word, the attacker faces Argon2id with 64MB/3 passes. Immediate risk is low but not zero.

2. **Rotate all variable values immediately.** Do not wait for a confirmed breach — assume the worst and rotate:
   ```bash
   envcp list            # Get all variable names
   # For each service, rotate the credential at the service level
   # Then update in EnvCP:
   envcp add API_KEY --value "<new-value>"
   ```

3. **Change the vault password:**
   ```bash
   envcp change-password
   ```

4. **Revoke any API keys** stored as variables (at the service provider level).

5. **Check audit logs** for signs of prior unauthorized access:
   ```bash
   cat .envcp/logs/operations-*.log | jq 'select(.operation == "auth_failure")'
   ```

6. **Report to contact@envcp.org** if you believe a vulnerability in EnvCP enabled the theft.

---

### Scenario 2 — Session compromised

**Symptoms:** You suspect another process or user accessed your active (unlocked) session.

**Steps:**

1. **Lock immediately:**
   ```bash
   envcp lock
   ```

2. **Kill the server process** if running:
   ```bash
   envcp serve --stop    # or: pkill -f "envcp serve"
   ```

3. **Review audit logs** for unexpected operations during the suspected window:
   ```bash
   cat .envcp/logs/operations-$(date +%F).log | jq .
   ```

4. **Rotate any variables that were accessed** during the compromised window (check logs for which names were queried).

5. **Check for unexpected processes** that may have accessed the session:
   ```bash
   lsof .envcp/.session    # Which processes had the session file open
   ```

6. **Reduce session timeout** to limit future exposure:
   ```yaml
   session:
     timeout_minutes: 10
   ```

---

### Scenario 3 — API key leaked

**Symptoms:** Your EnvCP API key (`server.api_key` in config) was exposed — in a log, a commit, a screenshot, or a public paste.

**Steps:**

1. **Generate a new API key:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Update the config:**
   ```yaml
   server:
     api_key: "<new-key>"
   ```

3. **Restart the EnvCP server** to apply the new key:
   ```bash
   envcp serve --mode rest --port 3456
   ```

4. **Update any clients** (Claude Code MCP config, Cursor, etc.) with the new key.

5. **Review audit logs** for any requests made with the old key from unexpected IPs:
   ```bash
   cat .envcp/logs/operations-*.log | jq 'select(.operation == "auth_failure")'
   ```

6. **If the leaked key was used to access variables**, rotate those variable values at the service level.

7. **Check where the key was leaked** (git history, logs, screenshots) and purge it:
   ```bash
   git log --all -p | grep -i "api_key"    # Check git history
   git filter-repo --path .envcp/config.yaml --invert-paths   # Remove from history if committed
   ```

---

### Scenario 4 — Vault password compromised

**Symptoms:** You believe someone knows your vault master password (e.g. observed at unlock, found in shell history, or extracted from memory).

**Steps:**

1. **Lock immediately:**
   ```bash
   envcp lock
   ```

2. **Export all variables** (you'll need the current password for this):
   ```bash
   envcp unlock
   envcp export --format json > vault-export.json
   envcp lock
   ```

3. **Create a new vault** with a strong new password:
   ```bash
   mv .envcp/ .envcp-old/
   envcp init            # Choose a new, strong password
   ```

4. **Re-import variables:**
   ```bash
   envcp unlock
   envcp import vault-export.json
   envcp lock
   ```

5. **Delete the old vault and export file:**
   ```bash
   rm -rf .envcp-old/
   rm vault-export.json    # Contains plaintext values — delete immediately
   ```

6. **Rotate all variable values** at the service level — the compromised party may have already decrypted the old vault.

7. **Check shell history** and clear it:
   ```bash
   history | grep envcp    # Look for --password flags
   history -c              # Clear history
   ```

---

### Scenario 5 — Malicious variable access detected in logs

**Symptoms:** Audit logs show `envcp_get` or `envcp_run` calls on unexpected variables, from unexpected sources, or at unexpected times.

**Steps:**

1. **Identify the scope** — which variables were accessed:
   ```bash
   cat .envcp/logs/operations-*.log | jq 'select(.operation == "envcp_get") | {time: .timestamp, var: .variable, source: .source}'
   ```

2. **Identify the source** — `cli`, `api`, or `mcp`:
   - `api` — check which IP made the request (logged on auth_failure; not on success — open risk)
   - `mcp` — the MCP client process on your machine
   - `cli` — you or a process running as you

3. **Lock the vault immediately** to stop further access:
   ```bash
   envcp lock
   pkill -f "envcp serve"
   ```

4. **Rotate the accessed variables** at the service level.

5. **If source is `api`** and the IP is unexpected:
   - Rotate the API key (see Scenario 3)
   - Check if the port was exposed externally (should only be `127.0.0.1`)
   - Review firewall rules

6. **If source is `mcp`** and the calls look like prompt injection:
   - Review what the AI client was processing when the calls occurred
   - Add the accessed variable names to `blacklist_patterns`
   - Consider setting `allow_ai_read: false` until the prompt injection vector is identified

7. **Harden access control** to prevent recurrence:
   ```yaml
   access:
     allow_ai_active_check: false
     blacklist_patterns:
       - "*_SECRET"
       - "*_KEY"
   ```

---

*See also: [Threat Model](THREAT_MODEL.md) for a full analysis of attack vectors. [Security Policy](../SECURITY.md) for vulnerability reporting.*
