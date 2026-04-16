use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::error::CryptoError;

/// Argon2id parameters. Serialized into the vault file so unlock re-uses the same params.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct KdfParams {
    /// memory cost in KiB
    pub m_cost: u32,
    /// time cost (iterations)
    pub t_cost: u32,
    /// parallelism
    pub p_cost: u32,
}

/// Default parameters: 256 MiB, 4 iterations, 2 lanes.
/// Strong baseline per OWASP 2026 guidance; auto-tune on first run may raise these.
pub const DEFAULT_KDF: KdfParams = KdfParams {
    m_cost: 256 * 1024,
    t_cost: 4,
    p_cost: 2,
};

/// Derive a 32-byte vault key from a master password + per-vault salt.
/// Returns a zeroize-protected key.
pub fn derive_key(
    password: &[u8],
    salt: &[u8],
    params: KdfParams,
) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let argon_params = Params::new(params.m_cost, params.t_cost, params.p_cost, Some(32))
        .map_err(|_| CryptoError::Kdf)?;
    let kdf = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);

    let mut out = Zeroizing::new([0u8; 32]);
    kdf.hash_password_into(password, salt, out.as_mut())
        .map_err(|_| CryptoError::Kdf)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_is_deterministic() {
        let a = derive_key(b"pw", &[0u8; 16], DEFAULT_KDF).unwrap();
        let b = derive_key(b"pw", &[0u8; 16], DEFAULT_KDF).unwrap();
        assert_eq!(a.as_ref(), b.as_ref());
    }

    #[test]
    fn different_salt_different_key() {
        let a = derive_key(b"pw", &[0u8; 16], DEFAULT_KDF).unwrap();
        let b = derive_key(b"pw", &[1u8; 16], DEFAULT_KDF).unwrap();
        assert_ne!(a.as_ref(), b.as_ref());
    }
}
