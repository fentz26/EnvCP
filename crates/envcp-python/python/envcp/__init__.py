"""envcp — Python bindings backed by envcp-core (Rust).

Exposes crypto primitives (Argon2id + AES-256-GCM, V1/V2 format) and a
``StorageManager`` class backed by the same on-disk format used by the
Node.js and CLI implementations. No Node.js required.
"""

from ._core import (
    __version__,
    StorageManager,
    encrypt,
    decrypt,
    hash_password,
    verify_password,
    generate_recovery_key,
    create_recovery_data,
    recover_password,
    hmac_sign,
    hmac_verify,
    generate_id,
    generate_session_token,
)

__all__ = [
    "__version__",
    "StorageManager",
    "encrypt",
    "decrypt",
    "hash_password",
    "verify_password",
    "generate_recovery_key",
    "create_recovery_data",
    "recover_password",
    "hmac_sign",
    "hmac_verify",
    "generate_id",
    "generate_session_token",
]
