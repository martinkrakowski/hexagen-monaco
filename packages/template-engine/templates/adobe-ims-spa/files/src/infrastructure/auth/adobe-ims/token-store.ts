import type { IMSTokens } from "../../../domain/ports/out/ims-auth.port";

const SECRET = process.env.AUTH_SESSION_SECRET ?? "";

async function secretKey(): Promise<CryptoKey> {
  // Hash the full secret with SHA-256 to produce exactly 32 bytes of key material.
  // This uses all available entropy regardless of secret length and format.
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function base64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Restore = padding stripped by base64urlEncode
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptTokens(tokens: IMSTokens): Promise<string> {
  if (!SECRET) throw new Error("AUTH_SESSION_SECRET is required for token encryption.");
  const key = await secretKey();
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(tokens));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const ivB64 = base64urlEncode(iv.buffer as ArrayBuffer);
  const ctB64 = base64urlEncode(ciphertext);
  return `${ivB64}.${ctB64}`;
}

export async function decryptTokens(encrypted: string): Promise<IMSTokens | null> {
  if (!SECRET) return null;
  try {
    const [ivB64, ctB64] = encrypted.split(".");
    if (!ivB64 || !ctB64) return null;
    const key = await secretKey();
    const iv = base64urlDecode(ivB64);
    const ciphertext = base64urlDecode(ctB64);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as IMSTokens;
  } catch {
    return null;
  }
}
