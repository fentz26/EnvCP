# EnvCP Assistant Context

This file provides context for AI assistants working with the EnvCP documentation.

## Project Overview

EnvCP is a secure environment variable manager for AI-assisted coding. It allows AI agents to reference secrets by name without seeing actual values.

## Key Concepts

- **Encrypted Storage**: AES-256-GCM with PBKDF2-SHA512 (100,000 iterations)
- **Reference-Based Access**: AI asks for variables by name, never sees values
- **Local-Only**: Secrets never leave the user's machine
- **Multi-Platform**: Works with Claude, ChatGPT, Gemini, local LLMs, and more

## Documentation Structure

- **Getting Started**: Installation, Quick Start
- **CLI Reference**: All commands and options
- **Configuration**: YAML configuration options
- **Integrations**: MCP, OpenAI, Gemini, Local LLMs
- **API Reference**: REST endpoints
- **Security**: Best practices, encryption details
- **Advanced**: Session management, troubleshooting

## Code Examples

All code examples use:
- Bash for CLI commands
- JavaScript/TypeScript for API usage
- YAML for configuration
- JSON for MCP settings

## Common Patterns

### Installation
```bash
npm install -g @fentz26/envcp
```

### Basic Usage
```bash
envcp init
envcp add API_KEY --value "secret"
envcp serve --mode auto
```

### MCP Integration
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

## Support

- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Email: contact@fentz.dev
- Docs: https://envcp.org/docs/
