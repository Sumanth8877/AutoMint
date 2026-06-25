use wasm_bindgen::prelude::*;
use k256::ecdsa::{SigningKey, Signature, VerifyingKey, signature::Signer, signature::Verifier};
use k256::sha2::{Sha256, Digest};
use hex::{encode, decode};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use aes_gcm::aead::{Aead};
use base64::{Engine as _, engine::general_purpose};

#[wasm_bindgen]
pub fn sign_transaction(private_key_hex: &str, message_hex: &str) -> String {
    console_error_panic_hook::set_once();
    
    match sign_transaction_internal(private_key_hex, message_hex) {
        Ok(signature) => signature,
        Err(e) => format!("ERROR: {}", e),
    }
}

fn sign_transaction_internal(private_key_hex: &str, message_hex: &str) -> Result<String, Box<dyn std::error::Error>> {
    let private_key_bytes = decode(private_key_hex)?;
    let signing_key = SigningKey::from_slice(&private_key_bytes)?;
    
    let message_bytes = decode(message_hex)?;
    let signature: Signature = signing_key.sign(&message_bytes);
    
    Ok(encode(signature.to_bytes()))
}

#[wasm_bindgen]
pub fn hash_message(message: &str) -> String {
    console_error_panic_hook::set_once();
    
    let mut hasher = Sha256::new();
    hasher.update(message.as_bytes());
    let result = hasher.finalize();
    encode(result)
}

#[wasm_bindgen]
pub fn verify_signature(public_key_hex: &str, message_hex: &str, signature_hex: &str) -> String {
    console_error_panic_hook::set_once();
    
    match verify_signature_internal(public_key_hex, message_hex, signature_hex) {
        Ok(is_valid) => is_valid.to_string(),
        Err(e) => format!("ERROR: {}", e),
    }
}

fn verify_signature_internal(public_key_hex: &str, message_hex: &str, signature_hex: &str) -> Result<bool, Box<dyn std::error::Error>> {
    let public_key_bytes = decode(public_key_hex)?;
    let verifying_key = VerifyingKey::from_sec1_bytes(&public_key_bytes)?;
    
    let message_bytes = decode(message_hex)?;
    let signature_bytes = decode(signature_hex)?;
    let signature = Signature::from_slice(&signature_bytes)?;
    
    Ok(verifying_key.verify(&message_bytes, &signature).is_ok())
}

#[wasm_bindgen]
pub fn generate_keypair() -> String {
    console_error_panic_hook::set_once();
    
    match generate_keypair_internal() {
        Ok((private_key, public_key)) => {
            format!("{}|{}", private_key, public_key)
        },
        Err(e) => format!("ERROR: {}", e),
    }
}

fn generate_keypair_internal() -> Result<(String, String), Box<dyn std::error::Error>> {
    let signing_key = SigningKey::random(&mut rand::rngs::OsRng);
    let verifying_key = VerifyingKey::from(&signing_key);
    
    let private_key = encode(signing_key.to_bytes());
    let public_key = encode(verifying_key.to_sec1_bytes());
    
    Ok((private_key, public_key))
}

#[wasm_bindgen]
pub fn encrypt_data(plaintext: &str, key_hex: &str) -> String {
    console_error_panic_hook::set_once();
    
    match encrypt_data_internal(plaintext, key_hex) {
        Ok(encrypted) => encrypted,
        Err(e) => format!("ERROR: {}", e),
    }
}

fn encrypt_data_internal(plaintext: &str, key_hex: &str) -> Result<String, Box<dyn std::error::Error>> {
    let key_bytes = decode(key_hex)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Invalid key: {}", e))?;
    
    let nonce_bytes = rand::random::<[u8; 12]>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;
    
    let combined: Vec<u8> = nonce_bytes.iter().chain(ciphertext.iter()).copied().collect();
    Ok(general_purpose::STANDARD.encode(combined))
}

#[wasm_bindgen]
pub fn decrypt_data(encrypted_base64: &str, key_hex: &str) -> String {
    console_error_panic_hook::set_once();
    
    match decrypt_data_internal(encrypted_base64, key_hex) {
        Ok(decrypted) => decrypted,
        Err(e) => format!("ERROR: {}", e),
    }
}

fn decrypt_data_internal(encrypted_base64: &str, key_hex: &str) -> Result<String, Box<dyn std::error::Error>> {
    let key_bytes = decode(key_hex)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Invalid key: {}", e))?;
    
    let combined = general_purpose::STANDARD.decode(encrypted_base64)?;
    
    if combined.len() < 12 {
        return Err("Invalid ciphertext: too short".into());
    }
    
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;
    
    Ok(String::from_utf8(plaintext)?)
}
