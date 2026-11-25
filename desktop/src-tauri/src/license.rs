//! Hardware fingerprint + offline verification of the server-signed RS256 grace token.
//! The public key is compiled into the binary, so the token cannot be forged locally.

use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const PUBLIC_KEY_PEM: &str = include_str!("../keys/license_public.pem");

#[derive(Debug, Serialize, Deserialize)]
pub struct GraceClaims {
    pub sub: String,
    pub mid: String,
    pub sch: String,
    pub name: String,
    pub vu: String,
    pub st: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn machine_id() -> String {
    let raw = machine_uid::get().unwrap_or_else(|_| "unknown-machine".into());
    let digest = Sha256::digest(format!("scholardesk::{raw}").as_bytes());
    format!("HW-{}", hex::encode_upper(&digest[..6]))
}

pub fn verify(token: &str) -> Result<GraceClaims, String> {
    let key = DecodingKey::from_rsa_pem(PUBLIC_KEY_PEM.as_bytes()).map_err(|e| e.to_string())?;
    let mut v = Validation::new(Algorithm::RS256);
    v.set_audience(&["scholardesk-desktop"]);
    v.set_issuer(&["scholardesk-license-server"]);
    v.leeway = 0;
    v.validate_exp = true;
    let data = decode::<GraceClaims>(token, &key, &v).map_err(|e| e.to_string())?;
    if data.claims.mid != machine_id() {
        return Err("Grace token was issued for a different computer".into());
    }
    Ok(data.claims)
}
