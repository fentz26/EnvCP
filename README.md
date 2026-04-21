

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
<a href="https://github.com/fentz26/EnvCP"><img src="https://badgen.net/badge/lines/11k/000000?labelColor=000000" alt="lines"></a>
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

## What It Does

- Stores secrets on your machine
- Lets AI tools reference secrets by name instead of raw values
- Can sync values into `.env` files when you want
- Works with MCP, REST, OpenAI-compatible, and Gemini-compatible clients

---

## In v1.2.0

- Simpler first-time setup
- Interactive `config` and `rule` menus
- Per-variable and per-client AI rules
- Better service/startup setup
- General cleanup, hardening, and test coverage


## Quick Start

Install and initialize:

```bash
npm install -g @fentz26/envcp
envcp init   # choose Basic / Advanced / Manual setup for this project
```

Add your secrets:

```bash
envcp add API_KEY --from-env API_KEY
# or: printf '%s' "$API_KEY" | envcp add API_KEY --stdin
```

Start the MCP server for AI tools:

```bash
envcp serve
```

`envcp serve` walks up from the current directory looking for an
`envcp.yaml`; if none is found, it falls back to `~/.envcp/config.yaml`.
This means MCP clients launched from arbitrary working directories will
still find the vault and an active session. Use `--global` to skip the
project lookup entirely.

For setup, rules, and integrations, see [SETUP.md](SETUP.md).

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Docs Site](https://envcp.org/docs) | Main documentation |
| [Setup Guide](SETUP.md) | Install, configure, and connect tools |
| [Security Guide](docs/SECURITY_GUIDE.md) | Safer setup and incident response |
| [Verification](VERIFICATION.md) | Release verification steps |
| [Security Policy](SECURITY.md) | How to report security issues |

---

## License

SAL v1.0 — See [LICENSE](LICENSE) file for details.

## Support

- Email: contact@envcp.org
- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Documentation: https://envcp.org/docs
