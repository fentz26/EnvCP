use envcp_core::crypto;

// --- encrypt / decrypt ---

#[test]
fn round_trip() {
    let encrypted = crypto::encrypt("hello world secret", "test-password-123").unwrap();
    assert_ne!(encrypted, "hello world secret");
    assert_eq!(crypto::decrypt(&encrypted, "test-password-123").unwrap(), "hello world secret");
}

#[test]
fn wrong_password_fails() {
    let encrypted = crypto::encrypt("secret", "correct").unwrap();
    assert!(crypto::decrypt(&encrypted, "wrong").is_err());
}

#[test]
fn random_salt_produces_different_ciphertext() {
    let a = crypto::encrypt("same text", "same password").unwrap();
    let b = crypto::encrypt("same text", "same password").unwrap();
    assert_ne!(a, b);
}

#[test]
fn output_has_v2_prefix() {
    let encrypted = crypto::encrypt("data", "pass").unwrap();
    assert!(encrypted.starts_with("v2:"), "expected v2: prefix, got: {encrypted}");
}

// --- v1 legacy decrypt ---
// Construct a valid v1: blob using PBKDF2-SHA512 + AES-256-GCM, matching the Node.js format.
#[test]
fn decrypt_legacy_v1() {
    use aes_gcm::{aead::{Aead, KeyInit}, aes::Aes256, AesGcm, Key, Nonce};
    use aes_gcm::aes::cipher::typenum::U16;
    use pbkdf2::pbkdf2_hmac;
    use sha2::Sha512;

    type Aes256Gcm16 = AesGcm<Aes256, U16>;

    let password = "legacy-pass";
    let plaintext = "legacy-secret";

    // Build a v1: blob using the same 16-byte IV that Node.js uses
    let salt = [0xABu8; 64];
    let iv = [0xCDu8; 16];
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha512>(password.as_bytes(), &salt, 100_000, &mut key);

    let cipher = Aes256Gcm16::new(Key::<Aes256Gcm16>::from_slice(&key));
    let nonce = Nonce::from_slice(&iv);
    let ct_with_tag = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap();
    let (ct, tag) = ct_with_tag.split_at(ct_with_tag.len() - 16);

    let v1_data = format!("v1:{}{}{}{}", hex::encode(salt), hex::encode(iv), hex::encode(tag), hex::encode(ct));
    assert_eq!(crypto::decrypt(&v1_data, password).unwrap(), plaintext);
}

// --- password hashing ---

#[test]
fn hash_and_verify_password() {
    let hash = crypto::hash_password("my-secret").unwrap();
    assert!(crypto::verify_password("my-secret", &hash).unwrap());
    assert!(!crypto::verify_password("wrong", &hash).unwrap());
}

// --- recovery key ---

#[test]
fn recovery_key_is_48_hex_chars() {
    let key = crypto::generate_recovery_key();
    assert_eq!(key.len(), 48);
    assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn recovery_round_trip() {
    let recovery_key = crypto::generate_recovery_key();
    let data = crypto::create_recovery_data("vault-password", &recovery_key).unwrap();
    assert_eq!(crypto::recover_password(&data, &recovery_key).unwrap(), "vault-password");
}

// --- helpers ---

#[test]
fn generate_id_is_32_hex() {
    let id = crypto::generate_id();
    assert_eq!(id.len(), 32);
    assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn generate_session_token_is_64_hex() {
    let tok = crypto::generate_session_token();
    assert_eq!(tok.len(), 64);
    assert!(tok.chars().all(|c| c.is_ascii_hexdigit()));
}

// --- HMAC ---

#[test]
fn hmac_sign_and_verify() {
    let key = b"test-hmac-key-32-bytes-padded!!!";
    let sig = crypto::hmac_sign(key, "payload");
    assert!(crypto::hmac_verify(key, "payload", &sig));
    assert!(!crypto::hmac_verify(key, "other", &sig));
}

#[test]
fn hmac_verify_rejects_invalid_hex() {
    let key = b"key";
    assert!(!crypto::hmac_verify(key, "data", "not-hex!"));
}
