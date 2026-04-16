//! Vault persistence layer.
//!
//! Layout:
//! - `vault_meta` holds KDF params, salt, and the encrypted vault key.
//! - `items` holds per-row AEAD-sealed payloads.
//! - AAD for each item is `b"vg:item:v1:" || item_id`, binding ciphertext to its row id.

pub mod repo;
pub mod models;

pub use repo::{VaultRepo, VaultError};
pub use models::{Folder, Item, ItemKind, ItemPayload, ItemSummary};
