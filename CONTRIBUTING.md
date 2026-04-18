# Contributing to EnvCP

Thank you for your interest in contributing to EnvCP! We welcome contributions from the community.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue on GitHub with:
- A clear description of the problem
- Steps to reproduce the issue
- Expected vs actual behavior
- Your environment (OS, Node version, etc.)
- Relevant logs or error messages

### Suggesting Features

We welcome feature suggestions! Please open an issue with:
- A clear description of the feature
- Use cases and benefits
- Any implementation ideas you have

### Pull Requests

1. **Fork the repository** and create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Write clean, readable code
   - Follow the existing code style
   - Add comments for complex logic
   - Update documentation if needed

3. **Test your changes**:
   ```bash
   npm run build
   npm test
   ```

4. **Commit your changes**:
   ```bash
   git commit -m "feat: brief description of your changes"
   ```
   Use conventional commit messages:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `chore:` for maintenance/tooling changes
   - `refactor:` for code refactoring
   - `docs:` for documentation changes
   - `test:` for adding or fixing tests
   - `ci:` for CI/CD changes

5. **Push and create a pull request**:
   ```bash
   git push origin feature/your-feature-name
   ```

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/fentz26/EnvCP.git
   cd EnvCP
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

4. **Test locally**:
   ```bash
   # Test CLI
   node dist/cli.js --help
   
   # Test in a sample project
   cd /path/to/test-project
   npx /path/to/EnvCP/dist/cli.js init
   ```

## Code Guidelines

- **TypeScript**: All code should be written in TypeScript
- **Types**: Use proper types, avoid `any` when possible
- **Error Handling**: Always handle errors gracefully
- **Security**: Never log or expose sensitive data
- **Comments**: Add JSDoc comments for public APIs
- **Dependencies**: Keep dependencies minimal and up-to-date

## Project Structure

```
EnvCP/
├── src/
│   ├── adapters/      # Protocol adapters (REST, OpenAI, Gemini, MCP base)
│   ├── cli/           # CLI command implementations
│   ├── config/        # Configuration loading and config-guard
│   ├── mcp/           # MCP server implementation
│   ├── server/        # Unified multi-protocol server
│   ├── storage/       # Encrypted storage and audit logging
│   ├── utils/         # Utilities (crypto, session, keychain, update-checker)
│   ├── vault/         # Global vault and vault management
│   └── types.ts       # Zod schemas and TypeScript types
├── __tests__/         # Jest test suite
└── dist/              # Compiled JavaScript (generated)
```

## Testing

Before submitting a PR:
1. Run the build: `npm run build`
2. Test the CLI: `node dist/cli.js --help`
3. Test each command manually
4. Test with different protocols (MCP, REST, OpenAI, Gemini)

## Security

If you discover a security vulnerability, please see [SECURITY.md](SECURITY.md) for how to report it.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards others

## Questions?

Feel free to open an issue for any questions about contributing!

## License

By contributing, you agree that your contributions will be licensed under the EnvCP Source Available License v1.0 (SAL-1.0). See [LICENSE](LICENSE) for details.
