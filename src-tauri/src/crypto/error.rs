use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("key derivation failed")]
    Kdf,
    #[error("encryption failed")]
    Encrypt,
    #[error("decryption failed or authentication mismatch")]
    Decrypt,
    #[error("invalid serialized format")]
    Format,
}
