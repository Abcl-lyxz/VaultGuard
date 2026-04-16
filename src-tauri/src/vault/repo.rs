use std::path::Path;

use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use thiserror::Error;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::{derive_key, new_random_key, open, seal, KdfParams, SealedBlob, VaultKey};

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("db error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("serialization error")]
    Serde,
    #[error("crypto error")]
    Crypto,
    #[error("vault is locked")]
    Locked,
    #[error("vault already initialized")]
    AlreadyInitialized,
    #[error("invalid master password")]
    BadPassword,
}

impl From<crate::crypto::CryptoError> for VaultError {
    fn from(_: crate::crypto::CryptoError) -> Self {
        VaultError::Crypto
    }
}

impl From<serde_json::Error> for VaultError {
    fn from(_: serde_json::Error) -> Self {
        VaultError::Serde
    }
}

const MIGRATIONS: &[&str] = &[
    // v1: initial schema
    r#"
    CREATE TABLE IF NOT EXISTS vault_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        kdf_m INTEGER NOT NULL,
        kdf_t INTEGER NOT NULL,
        kdf_p INTEGER NOT NULL,
        kdf_salt BLOB NOT NULL,
        wrapped_key_nonce BLOB NOT NULL,
        wrapped_key_ct BLOB NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        folder_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        payload_nonce BLOB NOT NULL,
        payload_ct BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
    CREATE INDEX IF NOT EXISTS idx_items_folder ON items(folder_id);
    CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT,
        created_at INTEGER NOT NULL
    );
    "#,
];

/// Holds an open DB connection and, when unlocked, the decrypted vault key.
pub struct VaultRepo {
    conn: Connection,
    key: Option<VaultKey>,
}

impl VaultRepo {
    pub fn open(path: &Path) -> Result<Self, VaultError> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        for m in MIGRATIONS {
            conn.execute_batch(m)?;
        }
        Ok(Self { conn, key: None })
    }

    pub fn is_initialized(&self) -> Result<bool, VaultError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM vault_meta WHERE id = 1", [], |r| r.get(0))?;
        Ok(count > 0)
    }

    pub fn is_unlocked(&self) -> bool {
        self.key.is_some()
    }

    /// Initialize a fresh vault with the given master password.
    /// Generates salt + random vault key, wraps the vault key with the KDF-derived key.
    pub fn create(&mut self, password: &str, params: KdfParams) -> Result<(), VaultError> {
        if self.is_initialized()? {
            return Err(VaultError::AlreadyInitialized);
        }
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);

        let kek_vk: VaultKey = derive_key(password.as_bytes(), &salt, params)?;

        let vault_key = new_random_key();
        let wrapped = seal(&kek_vk, vault_key.as_ref(), b"vg:wrap:v1")?;

        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        self.conn.execute(
            "INSERT INTO vault_meta (id, schema_version, kdf_m, kdf_t, kdf_p, kdf_salt, wrapped_key_nonce, wrapped_key_ct, created_at) \
             VALUES (1, 1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                params.m_cost,
                params.t_cost,
                params.p_cost,
                salt.to_vec(),
                wrapped.nonce.to_vec(),
                wrapped.ct,
                now,
            ],
        )?;
        self.key = Some(vault_key);
        Ok(())
    }

    /// Verify master password and load the vault key into memory.
    pub fn unlock(&mut self, password: &str) -> Result<(), VaultError> {
        let (m, t, p, salt, nonce, ct): (u32, u32, u32, Vec<u8>, Vec<u8>, Vec<u8>) = self
            .conn
            .query_row(
                "SELECT kdf_m, kdf_t, kdf_p, kdf_salt, wrapped_key_nonce, wrapped_key_ct FROM vault_meta WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )?;

        let kek_vk: VaultKey = derive_key(
            password.as_bytes(),
            &salt,
            KdfParams {
                m_cost: m,
                t_cost: t,
                p_cost: p,
            },
        )?;

        let mut nonce_arr = [0u8; 24];
        if nonce.len() != 24 {
            return Err(VaultError::Crypto);
        }
        nonce_arr.copy_from_slice(&nonce);
        let blob = SealedBlob {
            nonce: nonce_arr,
            ct,
        };
        let vk_bytes = open(&kek_vk, &blob, b"vg:wrap:v1").map_err(|_| VaultError::BadPassword)?;
        if vk_bytes.len() != 32 {
            return Err(VaultError::Crypto);
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&vk_bytes);
        self.key = Some(Zeroizing::new(arr));
        Ok(())
    }

    pub fn lock(&mut self) {
        self.key = None;
    }

    fn key(&self) -> Result<&VaultKey, VaultError> {
        self.key.as_ref().ok_or(VaultError::Locked)
    }

    /// Canonical DB string for an item kind. Kept infallible so encrypt/decrypt
    /// paths never panic on serde edge cases.
    fn kind_str(k: super::models::ItemKind) -> &'static str {
        use super::models::ItemKind::*;
        match k {
            Login => "login",
            Card => "card",
            PinNote => "pin_note",
            CryptoWallet => "crypto_wallet",
            Identity => "identity",
            SshKey => "ssh_key",
            ApiKey => "api_key",
            Totp => "totp",
        }
    }

    /// AAD binds payload to row id + schema version.
    fn item_aad(id: &Uuid) -> Vec<u8> {
        let mut v = Vec::with_capacity(16 + id.as_bytes().len());
        v.extend_from_slice(b"vg:item:v1:");
        v.extend_from_slice(id.as_bytes());
        v
    }

    pub fn insert_item(&self, item: &super::models::Item) -> Result<(), VaultError> {
        let key = self.key()?;
        let payload = serde_json::to_vec(&item.payload)?;
        let aad = Self::item_aad(&item.id);
        let blob = seal(key, &payload, &aad)?;
        let kind = Self::kind_str(item.kind);
        self.conn.execute(
            "INSERT INTO items (id, kind, name, favorite, folder_id, created_at, updated_at, payload_nonce, payload_ct) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                item.id.to_string(),
                kind,
                item.name,
                item.favorite as i64,
                item.folder_id.map(|u| u.to_string()),
                item.created_at,
                item.updated_at,
                blob.nonce.to_vec(),
                blob.ct,
            ],
        )?;
        Ok(())
    }

    pub fn get_item(&self, id: &Uuid) -> Result<Option<super::models::Item>, VaultError> {
        let key = self.key()?;
        let row = self.conn.query_row(
            "SELECT id, kind, name, favorite, folder_id, created_at, updated_at, payload_nonce, payload_ct FROM items WHERE id = ?1",
            params![id.to_string()],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, Vec<u8>>(7)?,
                    r.get::<_, Vec<u8>>(8)?,
                ))
            },
        ).optional()?;

        let Some((id_s, kind_s, name, fav, folder_s, created, updated, nonce, ct)) = row else {
            return Ok(None);
        };
        let id = Uuid::parse_str(&id_s).map_err(|_| VaultError::Serde)?;
        let kind: super::models::ItemKind =
            serde_json::from_value(serde_json::Value::String(kind_s))?;
        let folder_id = match folder_s {
            Some(s) => Some(Uuid::parse_str(&s).map_err(|_| VaultError::Serde)?),
            None => None,
        };
        let mut nonce_arr = [0u8; 24];
        if nonce.len() != 24 {
            return Err(VaultError::Crypto);
        }
        nonce_arr.copy_from_slice(&nonce);
        let aad = Self::item_aad(&id);
        let pt = open(key, &SealedBlob { nonce: nonce_arr, ct }, &aad)?;
        let payload: super::models::ItemPayload = serde_json::from_slice(&pt)?;
        Ok(Some(super::models::Item {
            id,
            kind,
            name,
            favorite: fav != 0,
            folder_id,
            created_at: created,
            updated_at: updated,
            payload,
        }))
    }

    /// List lightweight item summaries (no payload decryption). Used for main list view.
    pub fn list_summaries(&self) -> Result<Vec<super::models::ItemSummary>, VaultError> {
        // Require unlocked so we fail fast if someone tries to enumerate while locked.
        let _ = self.key()?;
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, name, favorite, folder_id, created_at, updated_at \
             FROM items ORDER BY favorite DESC, name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id_s, kind_s, name, fav, folder_s, created, updated) = row?;
            let id = Uuid::parse_str(&id_s).map_err(|_| VaultError::Serde)?;
            let kind: super::models::ItemKind =
                serde_json::from_value(serde_json::Value::String(kind_s))?;
            let folder_id = match folder_s {
                Some(s) => Some(Uuid::parse_str(&s).map_err(|_| VaultError::Serde)?),
                None => None,
            };
            out.push(super::models::ItemSummary {
                id,
                kind,
                name,
                favorite: fav != 0,
                folder_id,
                created_at: created,
                updated_at: updated,
            });
        }
        Ok(out)
    }

    pub fn update_item(&self, item: &super::models::Item) -> Result<(), VaultError> {
        let key = self.key()?;
        let payload = serde_json::to_vec(&item.payload)?;
        let aad = Self::item_aad(&item.id);
        let blob = seal(key, &payload, &aad)?;
        let kind = Self::kind_str(item.kind);
        let n = self.conn.execute(
            "UPDATE items SET kind = ?2, name = ?3, favorite = ?4, folder_id = ?5, updated_at = ?6, payload_nonce = ?7, payload_ct = ?8 \
             WHERE id = ?1",
            params![
                item.id.to_string(),
                kind,
                item.name,
                item.favorite as i64,
                item.folder_id.map(|u| u.to_string()),
                item.updated_at,
                blob.nonce.to_vec(),
                blob.ct,
            ],
        )?;
        if n == 0 {
            return Err(VaultError::Db(rusqlite::Error::QueryReturnedNoRows));
        }
        Ok(())
    }

    pub fn delete_item(&self, id: &Uuid) -> Result<(), VaultError> {
        let _ = self.key()?;
        self.conn
            .execute("DELETE FROM items WHERE id = ?1", params![id.to_string()])?;
        Ok(())
    }

    pub fn list_folders(&self) -> Result<Vec<super::models::Folder>, VaultError> {
        let _ = self.key()?;
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, parent_id, created_at FROM folders ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id_s, name, parent_s, created) = row?;
            let id = Uuid::parse_str(&id_s).map_err(|_| VaultError::Serde)?;
            let parent_id = match parent_s {
                Some(s) => Some(Uuid::parse_str(&s).map_err(|_| VaultError::Serde)?),
                None => None,
            };
            out.push(super::models::Folder {
                id,
                name,
                parent_id,
                created_at: created,
            });
        }
        Ok(out)
    }

    pub fn create_folder(&self, name: &str, parent_id: Option<Uuid>) -> Result<Uuid, VaultError> {
        let _ = self.key()?;
        let id = Uuid::new_v4();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        self.conn.execute(
            "INSERT INTO folders (id, name, parent_id, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id.to_string(), name, parent_id.map(|u| u.to_string()), now],
        )?;
        Ok(id)
    }

    pub fn rename_folder(&self, id: &Uuid, name: &str) -> Result<(), VaultError> {
        let _ = self.key()?;
        self.conn.execute(
            "UPDATE folders SET name = ?2 WHERE id = ?1",
            params![id.to_string(), name],
        )?;
        Ok(())
    }

    pub fn delete_folder(&self, id: &Uuid) -> Result<(), VaultError> {
        let _ = self.key()?;
        // Null-out folder_id on items that referenced it.
        self.conn.execute(
            "UPDATE items SET folder_id = NULL WHERE folder_id = ?1",
            params![id.to_string()],
        )?;
        self.conn
            .execute("DELETE FROM folders WHERE id = ?1", params![id.to_string()])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::models::{Item, ItemKind, ItemPayload};

    fn mk_repo() -> VaultRepo {
        let tmp = tempfile();
        VaultRepo::open(&tmp).unwrap()
    }

    fn tempfile() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("vg-test-{}.db", Uuid::new_v4()));
        p
    }

    // Use low KDF for test speed; production uses DEFAULT_KDF.
    const TEST_KDF: KdfParams = KdfParams {
        m_cost: 8 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    #[test]
    fn create_unlock_roundtrip() {
        let path = tempfile();
        {
            let mut r = VaultRepo::open(&path).unwrap();
            r.create("pw", TEST_KDF).unwrap();
            assert!(r.is_unlocked());
        }
        let mut r = VaultRepo::open(&path).unwrap();
        assert!(r.is_initialized().unwrap());
        assert!(!r.is_unlocked());
        r.unlock("pw").unwrap();
        assert!(r.is_unlocked());
    }

    #[test]
    fn wrong_password_fails() {
        let path = tempfile();
        {
            let mut r = VaultRepo::open(&path).unwrap();
            r.create("right", TEST_KDF).unwrap();
        }
        let mut r = VaultRepo::open(&path).unwrap();
        assert!(matches!(r.unlock("wrong"), Err(VaultError::BadPassword)));
    }

    #[test]
    fn insert_and_get_item() {
        let mut r = mk_repo();
        r.create("pw", TEST_KDF).unwrap();

        let id = Uuid::new_v4();
        let item = Item {
            id,
            kind: ItemKind::Login,
            name: "GitHub".to_string(),
            favorite: true,
            folder_id: None,
            created_at: 1,
            updated_at: 1,
            payload: ItemPayload::Login {
                username: "u".into(),
                password: "p".into(),
                url: Some("https://github.com".into()),
                notes: None,
                totp_secret: None,
            },
        };
        r.insert_item(&item).unwrap();
        let got = r.get_item(&id).unwrap().unwrap();
        assert_eq!(got.name, "GitHub");
        match got.payload {
            ItemPayload::Login { username, password, .. } => {
                assert_eq!(username, "u");
                assert_eq!(password, "p");
            }
            _ => panic!("wrong kind"),
        }
    }
}
