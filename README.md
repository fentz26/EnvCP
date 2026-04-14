

<p align="center">
<a href="https://envcp.org/docs"><img src="./assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@fentz26/envcp"><img src="https://img.shields.io/npm/v/%40fentz26%2Fenvcp?style=flat-square&color=000000&labelColor=000000&label=version" alt="npm version"></a>
<a href="https://www.npmjs.com/package/@fentz26/envcp"><img src="https://img.shields.io/npm/dt/%40fentz26%2Fenvcp?style=flat-square&color=000000&labelColor=000000&label=downloads" alt="npm downloads"></a>
<a href="https://www.npmjs.com/package/@fentz26/envcp"><img src="https://img.shields.io/npm/unpacked-size/%40fentz26%2Fenvcp?style=flat-square&color=000000&labelColor=000000&label=size" alt="npm size"></a>
<a href="https://github.com/fentz26/EnvCP/actions"><img src="https://img.shields.io/github/actions/workflow/status/fentz26/EnvCP/ci.yml?style=flat-square&color=000000&labelColor=000000&label=ci" alt="CI"></a>
<a href="https://codecov.io/github/fentz26/EnvCP"><img src="https://img.shields.io/codecov/c/github/fentz26/EnvCP?style=flat-square&color=000000&labelColor=000000&label=coverage&token=FKMIN74O9C" alt="codecov"></a>
<a href="https://github.com/fentz26/EnvCP/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-SAL%20v1.0-000000?style=flat-square&labelColor=000000" alt="license"></a>
<a href="https://github.com/fentz26/EnvCP/releases"><img src="https://img.shields.io/badge/SLSA-3-000000?style=flat-square&labelColor=000000" alt="SLSA Level 3"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/node/v/%40fentz26%2Fenvcp?style=flat-square&color=000000&labelColor=000000&label=node" alt="node version"></a>
</p>

<p align="center">
<strong>Secure secrets for AI agents — local, encrypted, reference-only.</strong>
</p>

<p align="center">
<sup>
<a href="docs/i18n/README.fr.md">Français</a> |
<a href="docs/i18n/README.es.md">Español</a> |
<a href="docs/i18n/README.ko.md">한국어</a> |
<a href="docs/i18n/README.zh.md">中文</a> |
<a href="docs/i18n/README.vi.md">Tiếng Việt</a> |
<a href="docs/i18n/README.ja.md">日本語</a>
</sup>
</p>

<p align="center">
  <a href="vscode://anthropic.claude-code/add-mcp?name=envcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmZW50ejI2L2VudmNwIiwic2VydmUiLCItLW1vZGUiLCJtY3AiXX0%3D"><img src="https://img.shields.io/badge/VS_Code-Add_MCP-000000?style=flat-square&logo=visualstudiocode&logoColor=white&labelColor=000000" alt="Add to VS Code"></a>
  &nbsp;
  <a href="vscode-insiders://anthropic.claude-code/add-mcp?name=envcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmZW50ejI2L2VudmNwIiwic2VydmUiLCItLW1vZGUiLCJtY3AiXX0%3D"><img src="https://img.shields.io/badge/VS_Code_Insiders-Add_MCP-000000?style=flat-square&logo=visualstudiocode&logoColor=white&labelColor=000000" alt="Add to VS Code Insiders"></a>
</p>

<p align="center">
  <a href="https://cursor.com/en/install-mcp?name=envcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmZW50ejI2L2VudmNwIiwic2VydmUiLCItLW1vZGUiLCJtY3AiXX0%3D"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor"></a>
  &nbsp;
</p>

<p align="center">
  Secure environment variable management for AI-assisted coding.<br>
  MCP server that lets AI reference your secrets by name — never by value.
</p>

---

## Why EnvCP?

- **Local-only storage** — Your secrets never leave your machine
- **Encrypted at rest** — AES-256-GCM with Argon2id key derivation (64 MB memory, 3 passes)
- **Reference-based access** — AI references variables by name, never sees the actual values
- **Automatic .env injection** — Values can be automatically injected into your .env files
- **AI Access Control** — Block AI from proactively listing or checking your secrets
- **Universal Compatibility** — Works with any AI tool via MCP, OpenAI, Gemini, or REST protocols

---

## Quick Start

```bash
npm install -g @fentz26/envcp
envcp init
envcp add API_KEY --value "your-secret-key"
envcp serve --mode auto --port 3456
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Setup Guide](SETUP.md) | Installation, CLI reference, integrations, configuration |
| [Verification](VERIFICATION.md) | SLSA 3 provenance verification — npm, GitHub CLI, slsa-verifier |
| [Security Policy](SECURITY.md) | Vulnerability reporting, encryption details, best practices |

---

## Security & Supply Chain

- **SLSA Level 3** — Build provenance for supply chain integrity ([verify →](VERIFICATION.md))
- **Encrypted at rest** — AES-256-GCM with Argon2id key derivation
- **Local-only** — Your secrets never leave your machine
- **SHA-pinned CI** — All GitHub Actions pinned to immutable commit SHAs
- **Signed npm releases** — `npm audit signatures` verifiable from v1.2.0+

---

## License

SAL v1.0 — See [LICENSE](LICENSE) file for details.

## Support

- Email: contact@envcp.org
- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Documentation: https://envcp.org/docs
