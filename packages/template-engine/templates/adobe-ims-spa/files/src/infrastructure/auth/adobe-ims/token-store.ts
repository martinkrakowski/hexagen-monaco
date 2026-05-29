import type { IMSTokens } from "../../../domain/ports/out/ims-auth.port";

const SECRET = process.env.AUTH_SESSION_SECRET ?? "";

function secretKey(): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(SECRET.slice(0, 32).padEnd(32, "0"));
  // Copy into a plain ArrayBuffer so crypto.subtle.importKey accepts it in strict mode
  const raw = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
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
  const binary = atob(base64);
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

export const TOKEN_COOKIE_NAME = "__ims_tokens";
export const TOKEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function buildTokenCookieHeader(encrypted: string, secure: boolean): string {
  const parts = [
    `${TOKEN_COOKIE_NAME}=${encodeURIComponent(encrypted)}`,
    `Max-Age=${TOKEN_COOKIE_MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearTokenCookieHeader(secure: boolean): string {
  const parts = [
    `${TOKEN_COOKIE_NAME}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readTokenCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey.trim() === TOKEN_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}
