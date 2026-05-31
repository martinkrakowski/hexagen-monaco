import type { GoogleUser } from "./google-user";

const SECRET = process.env.AUTH_SESSION_SECRET ?? "";

interface SessionPayload {
  user: GoogleUser;
  expiresAt: number;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

async function secretKey(): Promise<CryptoKey> {
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
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptSession(user: GoogleUser): Promise<string> {
  if (!SECRET) throw new Error("AUTH_SESSION_SECRET is required.");
  const key = await secretKey();
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ user, expiresAt: Date.now() + SESSION_TTL_MS } satisfies SessionPayload),
  );
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${base64urlEncode(iv.buffer as ArrayBuffer)}.${base64urlEncode(ciphertext)}`;
}

export async function decryptSession(token: string): Promise<GoogleUser | null> {
  if (!SECRET) return null;
  try {
    const [ivB64, ctB64] = token.split(".");
    if (!ivB64 || !ctB64) return null;
    const key = await secretKey();
    const iv = base64urlDecode(ivB64);
    const ct = base64urlDecode(ctB64);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as SessionPayload;
    if (typeof payload.expiresAt !== "number" || payload.expiresAt <= Date.now()) {
      return null;
    }
    return payload.user;
  } catch {
    return null;
  }
}
