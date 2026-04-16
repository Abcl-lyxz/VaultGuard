use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Login,
    Card,
    PinNote,
    CryptoWallet,
    Identity,
    SshKey,
    ApiKey,
    Totp,
}

/// Type-tagged payload persisted inside the AEAD-sealed blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ItemPayload {
    Login {
        username: String,
        password: String,
        url: Option<String>,
        notes: Option<String>,
        totp_secret: Option<String>,
    },
    Card {
        cardholder: String,
        number: String,
        cvv: String,
        expiry_month: u8,
        expiry_year: u16,
        notes: Option<String>,
    },
    PinNote {
        title: String,
        body: String,
    },
    CryptoWallet {
        wallet_name: String,
        seed_phrase: String,
        chain: Option<String>,
        address: Option<String>,
        notes: Option<String>,
    },
    Identity {
        full_name: String,
        national_id: Option<String>,
        passport: Option<String>,
        email: Option<String>,
        phone: Option<String>,
        address: Option<String>,
        notes: Option<String>,
    },
    SshKey {
        label: String,
        private_key: String,
        public_key: Option<String>,
        passphrase: Option<String>,
    },
    ApiKey {
        service: String,
        key: String,
        secret: Option<String>,
        notes: Option<String>,
    },
    Totp {
        label: String,
        secret: String,
        issuer: Option<String>,
        algorithm: String,
        digits: u8,
        period: u8,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub created_at: i64,
}

/// Lightweight listing entry — no payload. Used for the main list view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemSummary {
    pub id: Uuid,
    pub kind: ItemKind,
    pub name: String,
    pub favorite: bool,
    pub folder_id: Option<Uuid>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Metadata (unencrypted) + payload (decrypted in memory only when needed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: Uuid,
    pub kind: ItemKind,
    pub name: String,
    pub favorite: bool,
    pub folder_id: Option<Uuid>,
    pub created_at: i64,
    pub updated_at: i64,
    pub payload: ItemPayload,
}
