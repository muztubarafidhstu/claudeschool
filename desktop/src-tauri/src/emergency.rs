//! Emergency unlock codes (owner gives one by phone when a school is locked).
//!
//! code = first 8 chars (unambiguous base32) of HMAC-SHA256(secret, "<machine_id>:<lock_id>")
//! The secret is compiled in from the SD_EMERGENCY_SECRET build variable and also stored on the
//! license server, which generates the same code in the owner panel. Without a secret the feature is off.

use hmac::{Hmac, Mac};
use sha2::Sha256;

const SECRET: Option<&str> = option_env!("SD_EMERGENCY_SECRET");
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

pub fn enabled() -> bool {
    SECRET.map(|s| s.len() >= 16).unwrap_or(false)
}

pub fn code_for(machine_id: &str, lock_id: &str) -> Option<String> {
    let secret = SECRET.filter(|s| s.len() >= 16)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(format!("{machine_id}:{lock_id}").as_bytes());
    let out = mac.finalize().into_bytes();
    Some(out.iter().take(8).map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char).collect())
}

pub fn verify(machine_id: &str, lock_id: &str, code: &str) -> bool {
    let typed: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    match code_for(machine_id, lock_id) {
        Some(expected) => {
            // constant-time compare
            expected.len() == typed.len() && expected.bytes().zip(typed.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Same vector as cloud/src/lib.ts emergencyCode(); run with SD_EMERGENCY_SECRET=testsecret-1234567890
    #[test]
    fn matches_server_algorithm() {
        if SECRET != Some("testsecret-1234567890") {
            return;
        }
        assert_eq!(code_for("HW-ABCDEF123456", "1234-5678").as_deref(), Some("39VYTUNZ"));
        assert!(verify("HW-ABCDEF123456", "1234-5678", "39vy-tunz"));
        assert!(!verify("HW-ABCDEF123456", "1234-5679", "39VYTUNZ"));
    }
}
