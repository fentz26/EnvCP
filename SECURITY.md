# Security Policy

← [README](README.md) · [Setup Guide](SETUP.md) · [Verification](VERIFICATION.md)

## Supported Versions

We release patches for security vulnerabilities for the latest minor version only.

| Version | Supported | Notes |
| ------- | --------- | ----- |
| 1.1.x   | ✓         | Current — active security patches |
| 1.0.x   | ✗         | End of life — upgrade required |

### Why 1.0.x is not supported

- **Weaker encryption**: v1.0.x uses PBKDF2-SHA512 (100k iterations) for key derivation — vulnerable to GPU-based brute force
- **No run safety**: Missing command blacklist, root delete prevention, path manipulation guards
- **No brute-force lockout**: No rate limiting on failed unlock attempts
- **No HSM support**: No hardware security module integration
- **No memory hardening**: Vault password stored in plaintext in memory

### Upgrading from 1.0.x

Vaults created in 1.0.x (v1 PBKDF2 format) are **automatically migrated** to v2 (Argon2id) on next write. No manual action needed:

```bash
npm update -g @fentz26/envcp
envcp unlock  # Vault auto-migrates to v2 on first write
```

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in EnvCP, please report it by emailing:

**contact@envcp.org**

Please include:
- Type of vulnerability
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the vulnerability and how an attacker might exploit it

### What to Expect

- **Acknowledgment**: We will acknowledge your email within 48 hours
- **Updates**: We will provide regular updates on our progress
- **Disclosure**: We will work with you to understand and resolve the issue
- **Credit**: We will credit you in the security advisory (unless you prefer to remain anonymous)

### Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity and complexity
  - Critical: 1-7 days
  - High: 7-30 days
  - Medium: 30-90 days
  - Low: Best effort

## Security Best Practices

When using EnvCP:

1. **Use Strong Passwords**
   - While EnvCP allows simple passwords, use strong passwords for sensitive data
   - Minimum 12 characters with mixed case, numbers, and symbols

2. **API Key Protection**
   - Always set an API key when using HTTP modes
   - Keep API keys secret and rotate them regularly
   - Use different keys for different environments

3. **Access Control**
   - Enable `allow_ai_active_check: false` to prevent AI from proactively listing variables
   - Use `blacklist_patterns` to block sensitive variables from AI access
   - Review access logs regularly in `.envcp/logs/`

4. **Session Management**
   - Lock sessions when not in use: `envcp lock`
   - Set reasonable session timeouts (default: 30 minutes)
   - Limit session extensions

5. **Storage Security**
   - Never commit `.envcp/` directory to version control
   - Add `.envcp/` to `.gitignore`
   - Backup encrypted storage securely
   - Use encrypted disk/filesystem when possible

6. **Network Security**
   - When using HTTP modes, bind to localhost only (default: 127.0.0.1)
   - Use HTTPS reverse proxy for remote access
   - Firewall the port (default: 3456)

7. **Updates**
   - Keep EnvCP updated to the latest version
   - Monitor security advisories
   - Review changelogs for security fixes

## Known Security Considerations

### 1. Encryption Strength
- EnvCP uses AES-256-GCM with Argon2id key derivation (64 MB memory, 3 passes)
- New stores are encrypted with v2 format (Argon2id); legacy v1 stores (PBKDF2-SHA512) are read-compatible
- Security depends on password strength
- Weak passwords can be brute-forced; EnvCP rejects known common passwords

### 2. Memory Exposure
- Decrypted values are temporarily in memory
- Use session timeouts to limit exposure
- Lock sessions when not needed

### 3. AI Access
- By default, AI cannot proactively list variables
- User must explicitly reference variable names
- Blacklist patterns block sensitive variables completely

### 4. MCP Protocol
- MCP uses stdio (no network exposure)
- HTTP modes require API key authentication
- Auto-detection helps prevent unauthorized access

### 5. Logging
- Operations are logged for audit
- Logs do not contain variable values
- Review logs regularly for suspicious activity

## Security Updates

Security updates will be released as:
- Patch versions (1.1.x) for minor security issues
- Minor versions (1.x.0) for significant security improvements
- Documented in GitHub Security Advisories
- **No backports to 1.0.x** — upgrade to latest required for security fixes

## Compliance

EnvCP is designed for local development use. For production or compliance-critical environments:
- Review encryption implementation
- Conduct security audit
- Implement additional controls as needed
- Consider hardware security modules (HSM) for key management

## Contact

For security concerns: **contact@envcp.org**

For general issues: https://github.com/fentz26/EnvCP/issues

## Security Documentation

| Document | Description |
|----------|-------------|
| [Security Guide](docs/SECURITY_GUIDE.md) | Deployment best practices, AI access control, incident response runbooks |
| [Threat Model](docs/THREAT_MODEL.md) | STRIDE analysis, attack trees, open risks |
| [Verification Guide](VERIFICATION.md) | SLSA 3 provenance verification |

---

## Supply Chain Security

Every release ships with a signed SLSA Level 3 provenance attestation.

- All GitHub Actions are SHA-pinned to immutable commit digests
- npm releases are signed with `--provenance` (verifiable via `npm audit signatures`)
- Build provenance is independently verifiable via Sigstore/Rekor

See the [Verification Guide](VERIFICATION.md) for step-by-step instructions.

## Acknowledgments

We thank the security researchers and community members who help keep EnvCP secure.
