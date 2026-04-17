use aes_gcm::aes::cipher::typenum::U16;
use aes_gcm::{
    aead::{Aead, KeyInit},
    aes::Aes256,
    AesGcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use hex;
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::digest::KeyInit as HmacKeyInit;
use sha2::{Sha256, Sha512};

use crate::error::{Error, Result};

const IV_LENGTH: usize = 16;
const AUTH_TAG_LENGTH: usize = 16;

// v2 (Argon2id)
const V2_SALT_LENGTH: usize = 16;
const V2_PREFIX: &str = "v2:";

// v1 legacy (PBKDF2-SHA512, decrypt only)
const V1_SALT_LENGTH: usize = 64;
const V1_ITERATIONS: u32 = 100_000;
const V1_PREFIX: &str = "v1:";

// Argon2id parameters — must stay in sync with the Node.js implementation
const ARGON2_MEMORY: u32 = 65536; // 64 MB
const ARGON2_TIME: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;
const ARGON2_HASH_LEN: usize = 32;

fn argon2_derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32]> {
    let params = Params::new(
        ARGON2_MEMORY,
        ARGON2_TIME,
        ARGON2_PARALLELISM,
        Some(ARGON2_HASH_LEN),
    )
    .map_err(|e| Error::Crypto(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| Error::Crypto(e.to_string()))?;
    Ok(key)
}

fn pbkdf2_derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha512>(password.as_bytes(), salt, V1_ITERATIONS, &mut key);
    key
}

fn aes_gcm_encrypt(
    key: &[u8; 32],
    iv: &[u8],
    plaintext: &[u8],
) -> Result<(Vec<u8>, [u8; AUTH_TAG_LENGTH])> {
    type Aes256Gcm16 = AesGcm<Aes256, U16>;
    let cipher = Aes256Gcm16::new(Key::<Aes256Gcm16>::from_slice(key));
    let nonce = Nonce::from_slice(iv);
    // aes-gcm appends the 16-byte tag to the ciphertext
    let ciphertext_with_tag = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| Error::Crypto(e.to_string()))?;
    let (ct, tag_bytes) = ciphertext_with_tag.split_at(ciphertext_with_tag.len() - AUTH_TAG_LENGTH);
    let mut tag = [0u8; AUTH_TAG_LENGTH];
    tag.copy_from_slice(tag_bytes);
    Ok((ct.to_vec(), tag))
}

fn aes_gcm_decrypt(
    key: &[u8; 32],
    iv: &[u8],
    ciphertext: &[u8],
    auth_tag: &[u8],
) -> Result<Vec<u8>> {
    type Aes256Gcm16 = AesGcm<Aes256, U16>;
    let cipher = Aes256Gcm16::new(Key::<Aes256Gcm16>::from_slice(key));
    let nonce = Nonce::from_slice(iv);
    // aes-gcm expects ciphertext || tag
    let mut ct_with_tag = ciphertext.to_vec();
    ct_with_tag.extend_from_slice(auth_tag);
    cipher
        .decrypt(nonce, ct_with_tag.as_slice())
        .map_err(|_| Error::DecryptFailed)
}

/// Encrypts plaintext with AES-256-GCM using an Argon2id-derived key.
/// Output: `v2:<salt_hex><iv_hex><tag_hex><ciphertext_hex>`
pub fn encrypt(plaintext: &str, password: &str) -> Result<String> {
    let mut salt = [0u8; V2_SALT_LENGTH];
    let mut iv = [0u8; IV_LENGTH];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut iv);

    let key = argon2_derive_key(password, &salt)?;
    let (ct, tag) = aes_gcm_encrypt(&key, &iv, plaintext.as_bytes())?;

    Ok(format!(
        "{}{}{}{}{}",
        V2_PREFIX,
        hex::encode(salt),
        hex::encode(iv),
        hex::encode(tag),
        hex::encode(ct),
    ))
}

/// Decrypts data produced by `encrypt`. Handles v2 (Argon2id), v1 (PBKDF2), and legacy unprefixed.
pub fn decrypt(ciphertext: &str, password: &str) -> Result<String> {
    if let Some(data) = ciphertext.strip_prefix(V2_PREFIX) {
        decrypt_v2(data, password)
    } else {
        let data = ciphertext.strip_prefix(V1_PREFIX).unwrap_or(ciphertext);
        decrypt_v1(data, password)
    }
}

fn decrypt_v2(data: &str, password: &str) -> Result<String> {
    let salt = hex::decode(&data[..V2_SALT_LENGTH * 2]).map_err(|_| Error::InvalidFormat)?;
    let iv_start = V2_SALT_LENGTH * 2;
    let iv =
        hex::decode(&data[iv_start..iv_start + IV_LENGTH * 2]).map_err(|_| Error::InvalidFormat)?;
    let tag_start = iv_start + IV_LENGTH * 2;
    let tag = hex::decode(&data[tag_start..tag_start + AUTH_TAG_LENGTH * 2])
        .map_err(|_| Error::InvalidFormat)?;
    let ct =
        hex::decode(&data[tag_start + AUTH_TAG_LENGTH * 2..]).map_err(|_| Error::InvalidFormat)?;

    let key = argon2_derive_key(password, &salt)?;
    let plaintext = aes_gcm_decrypt(&key, &iv, &ct, &tag)?;
    String::from_utf8(plaintext).map_err(|_| Error::InvalidFormat)
}

fn decrypt_v1(data: &str, password: &str) -> Result<String> {
    let salt = hex::decode(&data[..V1_SALT_LENGTH * 2]).map_err(|_| Error::InvalidFormat)?;
    let iv_start = V1_SALT_LENGTH * 2;
    let iv =
        hex::decode(&data[iv_start..iv_start + IV_LENGTH * 2]).map_err(|_| Error::InvalidFormat)?;
    let tag_start = iv_start + IV_LENGTH * 2;
    let tag = hex::decode(&data[tag_start..tag_start + AUTH_TAG_LENGTH * 2])
        .map_err(|_| Error::InvalidFormat)?;
    let ct =
        hex::decode(&data[tag_start + AUTH_TAG_LENGTH * 2..]).map_err(|_| Error::InvalidFormat)?;

    let key = pbkdf2_derive_key(password, &salt);
    let plaintext = aes_gcm_decrypt(&key, &iv, &ct, &tag)?;
    String::from_utf8(plaintext).map_err(|_| Error::InvalidFormat)
}

/// Hashes a password with Argon2id for per-variable password storage (PHC string format).
pub fn hash_password(password: &str) -> Result<String> {
    use argon2::password_hash::{PasswordHasher, SaltString};
    use rand::rngs::OsRng;

    let salt = SaltString::generate(&mut OsRng);
    let params = Params::new(
        ARGON2_MEMORY,
        ARGON2_TIME,
        ARGON2_PARALLELISM,
        Some(ARGON2_HASH_LEN),
    )
    .map_err(|e| Error::Crypto(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| Error::Crypto(e.to_string()))
}

/// Verifies a password against a stored Argon2id PHC hash.
pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};

    let parsed = PasswordHash::new(hash).map_err(|e| Error::Crypto(e.to_string()))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// Generates a 24-byte random recovery key encoded as 48 hex characters.
pub fn generate_recovery_key() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Encrypts the vault password with the recovery key for later recovery.
pub fn create_recovery_data(password: &str, recovery_key: &str) -> Result<String> {
    encrypt(password, recovery_key)
}

/// Recovers the vault password using the recovery key.
pub fn recover_password(recovery_data: &str, recovery_key: &str) -> Result<String> {
    decrypt(recovery_data, recovery_key)
}

/// HMAC-SHA256 over data using key.
pub fn hmac_sign(key: &[u8], data: &str) -> String {
    let mut mac =
        <Hmac<Sha256> as HmacKeyInit>::new_from_slice(key).expect("HMAC accepts any key size");
    mac.update(data.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Timing-safe HMAC-SHA256 verification.
pub fn hmac_verify(key: &[u8], data: &str, expected_hex: &str) -> bool {
    let mut mac =
        <Hmac<Sha256> as HmacKeyInit>::new_from_slice(key).expect("HMAC accepts any key size");
    mac.update(data.as_bytes());
    let expected = match hex::decode(expected_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };
    mac.verify_slice(&expected).is_ok()
}

/// Generates a random 16-byte ID as a hex string.
pub fn generate_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Generates a random 32-byte session token as a hex string.
pub fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
