pub mod crypto;
pub mod error;
pub mod storage;

pub use error::{Error, Result};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
