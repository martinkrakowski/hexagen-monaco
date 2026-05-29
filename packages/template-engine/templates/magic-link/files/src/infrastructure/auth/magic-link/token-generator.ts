import { MAGIC_LINK_CONFIG } from "./config";

// Token format: base64url(JSON{email,exp}) + "." + HMAC-SHA256 signature
// Self-contained: expiry is validated without a DB lookup.
// The used-token store only needs to track consumed signatures for replay protection.

function b64uEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64uToBinary(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

async function hmacKey(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(MAGIC_LINK_CONFIG.secret);
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey("raw", buf, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export interface TokenPayload {
  email: string;
  exp: number;
}

export async function generateToken(email: string): Promise<string> {
  const payload: TokenPayload = {
    email: email.toLowerCase().trim(),
    exp: Date.now() + MAGIC_LINK_CONFIG.ttlMs,
  };
  const payloadB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64uEncode(sig)}`;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx < 0) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);

  try {
    const sigBytes = Uint8Array.from(b64uToBinary(sigB64), (c) => c.charCodeAt(0));
    const key = await hmacKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64),
    );
    if (!valid) return null;

    const payloadJson = b64uToBinary(payloadB64);
    const payload = JSON.parse(payloadJson) as TokenPayload;

    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
