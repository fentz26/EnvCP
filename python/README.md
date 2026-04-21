# EnvCP Python Package

Python packaging for [EnvCP](https://github.com/fentz26/EnvCP).

Today this package is the Python-side wrapper for the EnvCP CLI. The repository also contains Rust/PyO3 work under `crates/envcp-python`, but that native module is not the default published wheel yet.

## Installation

```bash
pip install envcp
```

## Usage

```bash
envcp --version
envcp init
envcp add API_KEY --from-env API_KEY
envcp serve --mode mcp
```

## Current Status

- `python/envcp/` contains the Python CLI wrapper
- `crates/envcp-python/` contains the Rust/PyO3 native binding work
- the native Rust module is not the default published Python wheel yet

## Requirements

- Python 3.8+
- Node.js is still required for the current CLI package

## Building from Source

```bash
git clone https://github.com/fentz26/EnvCP
cd EnvCP/python
pip install -e .
```

## Links

- **Homepage:** https://envcp.org
- **Documentation:** https://envcp.org/docs
- **GitHub:** https://github.com/fentz26/EnvCP
- **npm (Node.js):** https://www.npmjs.com/package/@fentz26/envcp
