use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error("Decryption failed — wrong password or corrupted data")]
    DecryptFailed,

    #[error("Invalid encrypted data format")]
    InvalidFormat,

    #[error("Storage I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Storage file is not a regular file: {0}")]
    NotAFile(String),
}

pub type Result<T> = std::result::Result<T, Error>;
