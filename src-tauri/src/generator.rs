//! Cryptographically-secure password / passphrase generator.

use rand::{rngs::OsRng, seq::SliceRandom, Rng};
use serde::{Deserialize, Serialize};

const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{};:,.<>/?";

/// Reduced ambiguous set: removes 0/O/o/1/l/I.
const AMBIGUOUS: &[u8] = b"0O o1lI";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GenOptions {
    pub length: usize,
    pub lower: bool,
    pub upper: bool,
    pub digits: bool,
    pub symbols: bool,
    pub exclude_ambiguous: bool,
}

impl Default for GenOptions {
    fn default() -> Self {
        Self {
            length: 20,
            lower: true,
            upper: true,
            digits: true,
            symbols: true,
            exclude_ambiguous: false,
        }
    }
}

pub fn generate_password(opts: &GenOptions) -> Result<String, &'static str> {
    if opts.length == 0 || opts.length > 256 {
        return Err("length out of range");
    }

    let mut pool: Vec<u8> = Vec::new();
    let mut groups: Vec<&[u8]> = Vec::new();

    let filter = |set: &[u8]| -> Vec<u8> {
        if opts.exclude_ambiguous {
            set.iter().copied().filter(|c| !AMBIGUOUS.contains(c)).collect()
        } else {
            set.to_vec()
        }
    };

    let lower_f = filter(LOWER);
    let upper_f = filter(UPPER);
    let digits_f = filter(DIGITS);
    let symbols_f = filter(SYMBOLS);

    if opts.lower {
        pool.extend_from_slice(&lower_f);
        groups.push(&lower_f);
    }
    if opts.upper {
        pool.extend_from_slice(&upper_f);
        groups.push(&upper_f);
    }
    if opts.digits {
        pool.extend_from_slice(&digits_f);
        groups.push(&digits_f);
    }
    if opts.symbols {
        pool.extend_from_slice(&symbols_f);
        groups.push(&symbols_f);
    }
    if pool.is_empty() {
        return Err("no character class selected");
    }
    if opts.length < groups.len() {
        return Err("length shorter than number of enabled character classes");
    }

    let mut rng = OsRng;
    // Guarantee at least one of each enabled class by seeding the output first.
    let mut out: Vec<u8> = Vec::with_capacity(opts.length);
    for g in &groups {
        let i = rng.gen_range(0..g.len());
        out.push(g[i]);
    }
    while out.len() < opts.length {
        let i = rng.gen_range(0..pool.len());
        out.push(pool[i]);
    }
    out.shuffle(&mut rng);
    Ok(String::from_utf8(out).map_err(|_| "internal")?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_length() {
        let opts = GenOptions::default();
        let p = generate_password(&opts).unwrap();
        assert_eq!(p.len(), 20);
    }

    #[test]
    fn no_class_selected_errors() {
        let opts = GenOptions {
            length: 10,
            lower: false,
            upper: false,
            digits: false,
            symbols: false,
            exclude_ambiguous: false,
        };
        assert!(generate_password(&opts).is_err());
    }

    #[test]
    fn digits_only() {
        let opts = GenOptions {
            length: 12,
            lower: false,
            upper: false,
            digits: true,
            symbols: false,
            exclude_ambiguous: false,
        };
        let p = generate_password(&opts).unwrap();
        assert!(p.chars().all(|c| c.is_ascii_digit()));
    }
}
