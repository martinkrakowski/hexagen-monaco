import type { UserContext } from "../../../domain/value-objects/user-context";

const SECRET = process.env.AUTH_SESSION_SECRET ?? "";

interface SessionPayload {
  user: UserContext;
}

function secretKey(): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(SECRET.slice(0, 32).padEnd(32, "0"));
  const raw = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function b64uEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64uDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptSession(user: UserContext): Promise<string> {
  if (!SECRET) throw new Error("AUTH_SESSION_SECRET is required.");
  const key = await secretKey();
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify({ user } satisfies SessionPayload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${b64uEncode(iv.buffer as ArrayBuffer)}.${b64uEncode(ciphertext)}`;
}

export async function decryptSession(token: string): Promise<UserContext | null> {
  if (!SECRET) return null;
  try {
    const [ivB64, ctB64] = token.split(".");
    if (!ivB64 || !ctB64) return null;
    const key = await secretKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64uDecode(ivB64) },
      key,
      b64uDecode(ctB64),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as SessionPayload;
    return payload.user;
  } catch {
    return null;
  }
}
