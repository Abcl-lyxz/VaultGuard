//! Encrypted vault export/import (`.vgx` v1).
//!
//! File format (JSON envelope):
//! ```json
//! {
//!   "magic": "VGX1",
//!   "version": 1,
//!   "kdf": {"m_cost":..,"t_cost":..,"p_cost":..},
//!   "salt":  "<base64>",
//!   "nonce": "<base64>",
//!   "ct":    "<base64>"
//! }
//! ```
//! The plaintext payload is a JSON `VaultPayload` containing all items (with
//! decrypted item-payloads) and folders. On import we derive the KEK from the
//! user's chosen passphrase, decrypt, and replay rows against the live repo.

use std::path::Path;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::{derive_key, open, seal, KdfParams, SealedBlob, VaultKey, DEFAULT_KDF};
use crate::vault::{Folder, Item, VaultError, VaultRepo};

const MAGIC: &str = "VGX1";
const FORMAT_VERSION: u32 = 1;
const EXPORT_AAD: &[u8] = b"vg:export:v1";

#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    magic: String,
    version: u32,
    kdf: KdfParams,
    salt: String,
    nonce: String,
    ct: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct VaultPayload {
    schema_version: u32,
    items: Vec<Item>,
    folders: Vec<Folder>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportStrategy {
    /// Keep existing items; import only new IDs. Safest default.
    Skip,
    /// Overwrite existing rows with same id.
    Overwrite,
    /// Always import, giving incoming items fresh IDs (no collision possible).
    KeepBoth,
}

#[derive(Debug, Serialize)]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub overwritten: usize,
    pub folders_added: usize,
}

/// Dump the unlocked vault to an encrypted `.vgx` file at `path`.
pub fn export_to_file(
    repo: &VaultRepo,
    path: &Path,
    passphrase: &str,
) -> Result<(), VaultError> {
    // Gather all items (decrypted) and folders.
    let summaries = repo.list_summaries()?;
    let mut items = Vec::with_capacity(summaries.len());
    for s in summaries {
        if let Some(i) = repo.get_item(&s.id)? {
            items.push(i);
        }
    }
    let folders = repo.list_folders()?;
    let payload = VaultPayload {
        schema_version: 1,
        items,
        folders,
    };
    let plaintext = Zeroizing::new(serde_json::to_vec(&payload).map_err(|_| VaultError::Serde)?);

    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let kek: VaultKey = derive_key(passphrase.as_bytes(), &salt, DEFAULT_KDF)?;
    let blob = seal(&kek, &plaintext, EXPORT_AAD)?;

    let env = Envelope {
        magic: MAGIC.into(),
        version: FORMAT_VERSION,
        kdf: DEFAULT_KDF,
        salt: B64.encode(salt),
        nonce: B64.encode(blob.nonce),
        ct: B64.encode(&blob.ct),
    };
    let bytes = serde_json::to_vec_pretty(&env).map_err(|_| VaultError::Serde)?;
    std::fs::write(path, bytes).map_err(|_| VaultError::Serde)?;
    Ok(())
}

/// Import a `.vgx` file into the unlocked vault with the given strategy.
pub fn import_from_file(
    repo: &VaultRepo,
    path: &Path,
    passphrase: &str,
    strategy: ImportStrategy,
) -> Result<ImportReport, VaultError> {
    let bytes = std::fs::read(path).map_err(|_| VaultError::Serde)?;
    let env: Envelope = serde_json::from_slice(&bytes).map_err(|_| VaultError::Serde)?;
    if env.magic != MAGIC {
        return Err(VaultError::Serde);
    }
    if env.version != FORMAT_VERSION {
        return Err(VaultError::Serde);
    }

    let salt = B64.decode(&env.salt).map_err(|_| VaultError::Serde)?;
    let nonce_v = B64.decode(&env.nonce).map_err(|_| VaultError::Serde)?;
    let ct = B64.decode(&env.ct).map_err(|_| VaultError::Serde)?;
    if nonce_v.len() != 24 {
        return Err(VaultError::Crypto);
    }
    let mut nonce = [0u8; 24];
    nonce.copy_from_slice(&nonce_v);

    let kek: VaultKey = derive_key(passphrase.as_bytes(), &salt, env.kdf)?;
    let pt = open(&kek, &SealedBlob { nonce, ct }, EXPORT_AAD)
        .map_err(|_| VaultError::BadPassword)?;

    let payload: VaultPayload = serde_json::from_slice(&pt).map_err(|_| VaultError::Serde)?;

    // Folders first (so items can reference them).
    let mut folders_added = 0usize;
    let existing_folders = repo.list_folders()?;
    for f in &payload.folders {
        if existing_folders.iter().any(|e| e.id == f.id) {
            continue;
        }
        repo.create_folder(&f.name, f.parent_id).ok();
        folders_added += 1;
    }

    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut overwritten = 0usize;
    for mut item in payload.items {
        let existing = repo.get_item(&item.id)?;
        match (existing.is_some(), strategy) {
            (false, _) => {
                repo.insert_item(&item)?;
                imported += 1;
            }
            (true, ImportStrategy::Skip) => {
                skipped += 1;
            }
            (true, ImportStrategy::Overwrite) => {
                repo.update_item(&item)?;
                overwritten += 1;
            }
            (true, ImportStrategy::KeepBoth) => {
                item.id = Uuid::new_v4();
                item.name = format!("{} (imported)", item.name);
                repo.insert_item(&item)?;
                imported += 1;
            }
        }
    }

    Ok(ImportReport {
        imported,
        skipped,
        overwritten,
        folders_added,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::KdfParams;
    use crate::vault::{Item, ItemKind, ItemPayload};

    const TEST_KDF: KdfParams = KdfParams {
        m_cost: 8 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    fn tmp(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("vg-export-{}-{}", name, Uuid::new_v4()));
        p
    }

    #[test]
    fn export_import_roundtrip() {
        // Source vault with 2 items.
        let src_path = tmp("src.db");
        let mut src = VaultRepo::open(&src_path).unwrap();
        src.create("master", TEST_KDF).unwrap();
        let id = Uuid::new_v4();
        src.insert_item(&Item {
            id,
            kind: ItemKind::Login,
            name: "Site".into(),
            favorite: false,
            folder_id: None,
            created_at: 0,
            updated_at: 0,
            payload: ItemPayload::Login {
                username: "u".into(),
                password: "p".into(),
                url: None,
                notes: None,
                totp_secret: None,
            },
        })
        .unwrap();

        let exp_path = tmp("out.vgx");
        export_to_file(&src, &exp_path, "export-pass").unwrap();

        // Fresh destination vault.
        let dst_path = tmp("dst.db");
        let mut dst = VaultRepo::open(&dst_path).unwrap();
        dst.create("other", TEST_KDF).unwrap();

        let report = import_from_file(&dst, &exp_path, "export-pass", ImportStrategy::Skip).unwrap();
        assert_eq!(report.imported, 1);
        assert_eq!(report.skipped, 0);
        assert!(dst.get_item(&id).unwrap().is_some());
    }

    #[test]
    fn wrong_passphrase_rejected() {
        let src_path = tmp("src.db");
        let mut src = VaultRepo::open(&src_path).unwrap();
        src.create("x", TEST_KDF).unwrap();
        let exp_path = tmp("out.vgx");
        export_to_file(&src, &exp_path, "right-pw").unwrap();

        let dst_path = tmp("dst.db");
        let mut dst = VaultRepo::open(&dst_path).unwrap();
        dst.create("y", TEST_KDF).unwrap();
        let err = import_from_file(&dst, &exp_path, "wrong-pw", ImportStrategy::Skip);
        assert!(matches!(err, Err(VaultError::BadPassword)));
    }

    #[test]
    fn skip_strategy_preserves_existing() {
        let path = tmp("a.db");
        let mut src = VaultRepo::open(&path).unwrap();
        src.create("m", TEST_KDF).unwrap();
        let id = Uuid::new_v4();
        let mut item = Item {
            id,
            kind: ItemKind::Login,
            name: "original".into(),
            favorite: false,
            folder_id: None,
            created_at: 0,
            updated_at: 0,
            payload: ItemPayload::Login {
                username: "orig".into(),
                password: "orig".into(),
                url: None,
                notes: None,
                totp_secret: None,
            },
        };
        src.insert_item(&item).unwrap();

        let exp = tmp("s.vgx");
        export_to_file(&src, &exp, "pw").unwrap();

        // Modify the source item.
        item.name = "changed".into();
        src.update_item(&item).unwrap();

        let rep = import_from_file(&src, &exp, "pw", ImportStrategy::Skip).unwrap();
        assert_eq!(rep.skipped, 1);
        assert_eq!(src.get_item(&id).unwrap().unwrap().name, "changed");
    }
}
