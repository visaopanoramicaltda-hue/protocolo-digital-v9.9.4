
import { Injectable } from '@angular/core';

export interface EncryptedPayload {
  v: number; // version
  iv: string; // base64
  data: string; // base64 ciphertext
  salt: string; // base64
}

@Injectable({ providedIn: 'root' })
export class SimbioseHashService {

  // Chave Mestra Derivada (Garante recuperação de sistema em qualquer dispositivo autorizado)
  private readonly MASTER_SECRET = 'SIMBIOSE_QUANTUM_CORE_V9_KEY_2025';

  async gerarHash(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async hashText(text: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // --- AES-256 GCM ENCRYPTION ENGINE ---

  async encryptData(plainText: string): Promise<EncryptedPayload> {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96 bits IV for GCM
    
    const keyMaterial = await this.getKeyMaterial();
    const key = await this.deriveKey(keyMaterial, salt);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      enc.encode(plainText)
    );

    return {
      v: 1,
      iv: this.buffToBase64(iv),
      salt: this.buffToBase64(salt),
      data: this.buffToBase64(new Uint8Array(encrypted))
    };
  }

  async decryptData(payload: EncryptedPayload): Promise<string> {
    try {
        const salt = this.base64ToBuff(payload.salt);
        const iv = this.base64ToBuff(payload.iv);
        const data = this.base64ToBuff(payload.data);

        const keyMaterial = await this.getKeyMaterial();
        const key = await this.deriveKey(keyMaterial, salt);

        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: iv },
          key,
          data
        );

        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error("Decryption Failed", e);
        throw new Error("Falha na descriptografia: Chave inválida ou dados corrompidos.");
    }
  }

  // --- CRYPTO UTILS ---
  
  private async getKeyMaterial() {
    const enc = new TextEncoder();
    return window.crypto.subtle.importKey(
      "raw",
      enc.encode(this.MASTER_SECRET),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
  }

  private async deriveKey(keyMaterial: CryptoKey, salt: Uint8Array) {
    return window.crypto.subtle.deriveKey(
      {
        "name": "PBKDF2",
        salt: salt,
        "iterations": 100000,
        "hash": "SHA-256"
      },
      keyMaterial,
      { "name": "AES-GCM", "length": 256 },
      true,
      [ "encrypt", "decrypt" ]
    );
  }

  private buffToBase64(buff: Uint8Array): string {
      return btoa(String.fromCharCode(...buff));
  }

  private base64ToBuff(b64: string): Uint8Array {
      const binStr = atob(b64);
      const len = binStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = binStr.charCodeAt(i);
      }
      return bytes;
  }
}
