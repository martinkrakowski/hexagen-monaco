function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function generatePKCEPair(): Promise<{ verifier: string; challenge: string }> {
  const random = new Uint8Array(new ArrayBuffer(128));
  crypto.getRandomValues(random);
  const verifier = base64url(random.buffer as ArrayBuffer);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(hash) };
}

export function generateState(): string {
  const random = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(random);
  return base64url(random.buffer as ArrayBuffer);
}
