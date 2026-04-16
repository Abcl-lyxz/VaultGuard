use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::error::CryptoError;

/// 32-byte symmetric key used for AEAD. Wiped on drop.
pub type VaultKey = Zeroizing<[u8; 32]>;

pub fn new_random_key() -> VaultKey {
    let mut k = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(k.as_mut());
    k
}

/// Self-describing sealed blob: 24-byte nonce + ciphertext (ciphertext includes 16-byte tag).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SealedBlob {
    pub nonce: [u8; 24],
    pub ct: Vec<u8>,
}

/// Encrypt `plaintext` with `key`. `aad` is bound into the tag for context separation.
pub fn seal(key: &VaultKey, plaintext: &[u8], aad: &[u8]) -> Result<SealedBlob, CryptoError> {
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ct = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::Encrypt)?;
    Ok(SealedBlob {
        nonce: nonce_bytes,
        ct,
    })
}

/// Decrypt `blob` with `key` + matching `aad`. Returns zeroize-protected plaintext.
pub fn open(key: &VaultKey, blob: &SealedBlob, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let nonce = XNonce::from_slice(&blob.nonce);
    let pt = cipher
        .decrypt(
            nonce,
            Payload {
                msg: &blob.ct,
                aad,
            },
        )
        .map_err(|_| CryptoError::Decrypt)?;
    Ok(Zeroizing::new(pt))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let k = new_random_key();
        let blob = seal(&k, b"secret data", b"aad-v1").unwrap();
        let pt = open(&k, &blob, b"aad-v1").unwrap();
        assert_eq!(pt.as_slice(), b"secret data");
    }

    #[test]
    fn wrong_key_fails() {
        let k1 = new_random_key();
        let k2 = new_random_key();
        let blob = seal(&k1, b"data", b"aad").unwrap();
        assert!(open(&k2, &blob, b"aad").is_err());
    }

    #[test]
    fn wrong_aad_fails() {
        let k = new_random_key();
        let blob = seal(&k, b"data", b"aad1").unwrap();
        assert!(open(&k, &blob, b"aad2").is_err());
    }

    #[test]
    fn tampered_ct_fails() {
        let k = new_random_key();
        let mut blob = seal(&k, b"data", b"aad").unwrap();
        blob.ct[0] ^= 1;
        assert!(open(&k, &blob, b"aad").is_err());
    }

    #[test]
    fn tamper_fuzz_rejects_every_single_bit_flip() {
        // Poor-man's fuzz: flip every bit in ct/nonce/aad exactly once and
        // verify every mutation is rejected. AEAD integrity guarantee.
        let k = new_random_key();
        let pt = b"the quick brown fox jumps over the lazy dog";
        let aad = b"vg:item:v1:aad";
        let blob = seal(&k, pt, aad).unwrap();

        for i in 0..blob.ct.len() {
            for bit in 0..8 {
                let mut b = blob.clone();
                b.ct[i] ^= 1 << bit;
                assert!(open(&k, &b, aad).is_err(), "ct bit flip accepted at {i}/{bit}");
            }
        }
        for i in 0..blob.nonce.len() {
            for bit in 0..8 {
                let mut b = blob.clone();
                b.nonce[i] ^= 1 << bit;
                assert!(open(&k, &b, aad).is_err(), "nonce bit flip accepted at {i}/{bit}");
            }
        }
        for i in 0..aad.len() {
            for bit in 0..8 {
                let mut a = aad.to_vec();
                a[i] ^= 1 << bit;
                assert!(open(&k, &blob, &a).is_err(), "aad bit flip accepted at {i}/{bit}");
            }
        }
    }

    #[test]
    fn unique_nonces() {
        let k = new_random_key();
        let a = seal(&k, b"x", b"").unwrap();
        let b = seal(&k, b"x", b"").unwrap();
        assert_ne!(a.nonce, b.nonce);
    }
}
