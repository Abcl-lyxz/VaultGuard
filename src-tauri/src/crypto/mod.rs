//! VaultGuard crypto core.
//!
//! Invariants:
//! - Every key-holding value is wiped on drop via `zeroize`.
//! - Plaintext is never logged; errors carry no secret material.
//! - KDF params are stored alongside ciphertext so future re-tuning stays backwards compatible.

pub mod error;
pub mod kdf;
pub mod aead;

pub use error::CryptoError;
pub use kdf::{KdfParams, derive_key, DEFAULT_KDF};
pub use aead::{SealedBlob, seal, open, VaultKey, new_random_key};
