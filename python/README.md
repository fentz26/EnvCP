# EnvCP Python Binding

Native Python binding for [EnvCP](https://github.com/fentz26/EnvCP) - an encrypted environment variable vault with AI access policies. Built on Rust + PyO3 for zero-dependency native performance.

## Installation

```bash
pip install envcp-core
```

Or with pipx:

```bash
pipx install envcp-core
```

## Usage

```python
from envcp import encrypt, decrypt, StorageManager

# Crypto operations
ciphertext = encrypt("my-secret-value", "my-password")
plaintext = decrypt(ciphertext, "my-password")

# StorageManager for encrypted vault files
sm = StorageManager("~/.envcp/vault.json", encrypted=True)
sm.set_password("my-password")

# Load, get, set, delete, list
vault_json = sm.load()
sm.set("API_KEY", '{"value":"secret","protected":false}')
sm.get("API_KEY")
sm.list()
sm.delete("API_KEY")
```

## API Reference

### Crypto Functions

| Function | Description |
|----------|-------------|
| `encrypt(plaintext, password) -> str` | AES-256-GCM encrypt with Argon2id |
| `decrypt(ciphertext, password) -> str` | Decrypt v1 (PBKDF2) or v2 (Argon2id) |
| `hash_password(password) -> str` | Argon2id password hash |
| `verify_password(password, hash) -> bool` | Verify password hash |
| `generate_recovery_key() -> str` | Generate 32-byte recovery key |
| `create_recovery_data(password, key) -> str` | Create encrypted recovery blob |
| `recover_password(data, key) -> str` | Recover password from recovery data |
| `hmac_sign(key, data) -> str` | HMAC-SHA256 signature |
| `hmac_verify(key, data, expected) -> bool` | Timing-safe HMAC verification |
| `generate_id() -> str` | Random ID |
| `generate_session_token() -> str` | Session token |

### StorageManager Class

| Method | Description |
|--------|-------------|
| `StorageManager(path, encrypted=True)` | Create manager for vault at path |
| `set_password(password)` | Set encryption password |
| `invalidate_cache()` | Clear in-memory cache |
| `exists() -> bool` | Check if vault file exists |
| `load() -> str` | Load full vault as JSON string |
| `get(name) -> Optional[str]` | Get single variable as JSON |
| `set(name, var_json)` | Set variable (var_json is JSON string) |
| `delete(name) -> bool` | Delete variable, returns True if existed |
| `list() -> List[str]` | List all variable names |

## Requirements

- Python 3.9+
- No Node.js dependency (native Rust binding)

## Building from Source

```bash
git clone https://github.com/fentz26/EnvCP
cd EnvCP
cargo build --release -p envcp-python
```

For wheel distribution:

```bash
pip install maturin
cd crates/envcp-python
maturin build --release
```

## Links

- **Homepage:** https://envcp.org
- **Documentation:** https://envcp.org/docs
- **GitHub:** https://github.com/fentz26/EnvCP
- **npm (Node.js):** https://www.npmjs.com/package/@fentz26/envcp
