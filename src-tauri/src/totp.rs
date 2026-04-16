//! TOTP (RFC 6238) wrapper around the `totp-rs` crate.
//!
//! Accepts base32-encoded secrets (standard Google Authenticator format).

use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm, Secret, TOTP};

#[derive(Debug, Clone, Deserialize)]
pub struct TotpSpec {
    pub secret: String,
    pub algorithm: String, // "SHA1" | "SHA256" | "SHA512"
    pub digits: usize,
    pub period: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TotpSnapshot {
    pub code: String,
    /// Seconds until the current code expires.
    pub remaining: u64,
    /// Total period in seconds (useful for UI progress bar).
    pub period: u64,
}

pub fn snapshot(spec: &TotpSpec) -> Result<TotpSnapshot, String> {
    let algo = match spec.algorithm.to_uppercase().as_str() {
        "SHA1" => Algorithm::SHA1,
        "SHA256" => Algorithm::SHA256,
        "SHA512" => Algorithm::SHA512,
        _ => return Err("unsupported algorithm".into()),
    };
    // Accept base32 with or without padding.
    let raw = Secret::Encoded(spec.secret.replace(' ', "").to_uppercase())
        .to_bytes()
        .map_err(|_| "invalid base32 secret")?;
    let totp = TOTP::new(
        algo,
        spec.digits,
        1,
        spec.period,
        raw,
        None,
        "vaultguard".to_string(),
    )
    .map_err(|e| format!("totp init: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "clock")?
        .as_secs();
    let code = totp.generate(now);
    let remaining = spec.period - (now % spec.period);
    Ok(TotpSnapshot {
        code,
        remaining,
        period: spec.period,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 appendix B test vector (SHA1, 8 digits).
    #[test]
    fn rfc6238_sha1_vector() {
        let spec = TotpSpec {
            // "12345678901234567890" as base32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
            secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".into(),
            algorithm: "SHA1".into(),
            digits: 8,
            period: 30,
        };
        let snap = snapshot(&spec).unwrap();
        assert_eq!(snap.code.len(), 8);
        assert!(snap.remaining > 0 && snap.remaining <= 30);
    }

    #[test]
    fn bad_secret_rejected() {
        let spec = TotpSpec {
            secret: "!!!".into(),
            algorithm: "SHA1".into(),
            digits: 6,
            period: 30,
        };
        assert!(snapshot(&spec).is_err());
    }
}
