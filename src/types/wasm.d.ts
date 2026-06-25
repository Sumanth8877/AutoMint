declare module '/wasm/wasm_crypto.js' {
  export default function init(): Promise<void>;
  export function sign_transaction(private_key_hex: string, message_hex: string): string;
  export function hash_message(message: string): string;
  export function verify_signature(public_key_hex: string, message_hex: string, signature_hex: string): string;
  export function generate_keypair(): string;
  export function encrypt_data(plaintext: string, key_hex: string): string;
  export function decrypt_data(encrypted_base64: string, key_hex: string): string;
}
