# EnvCP Python Wrapper

This is a Python wrapper for [EnvCP](https://github.com/fentz26/EnvCP) - an encrypted environment variable vault with AI access policies.

**Note:** This package requires Node.js to be installed, as it proxies commands to the Node.js CLI.

## Installation

```bash
pip install envcp
```

Or with pipx (recommended):

```bash
pipx install envcp
```

## Usage

Once installed, the `envcp` command will be available:

```bash
envcp init        # Initialize EnvCP in current project
envcp unlock      # Unlock session with password
envcp list        # List all variables (names only)
envcp get <name>  # Get a variable value
envcp set <name> <value>  # Set a variable
envcp --help      # Show all commands
```

## Requirements

- Python 3.8+
- Node.js 18+ (required for the actual CLI)

## How it works

This Python package is a thin wrapper that calls `npx @fentz26/envcp` under the hood. All commands and arguments are passed through to the Node.js CLI.

## Links

- **Homepage:** https://envcp.fentz.dev
- **Documentation:** https://envcp.fentz.dev/docs
- **GitHub:** https://github.com/fentz26/EnvCP
- **npm:** https://www.npmjs.com/package/@fentz26/envcp
