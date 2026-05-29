import { IMS_CONFIG, IMS_ENDPOINTS } from "./config";

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
  const encoded = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  const challenge = base64url(hash);
  return { verifier, challenge };
}

export function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: IMS_CONFIG.clientId,
    redirect_uri: IMS_CONFIG.redirectUri,
    response_type: "code",
    scope: IMS_CONFIG.scopes.join(","),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${IMS_ENDPOINTS.authorize}?${params.toString()}`;
}

export function generateState(): string {
  const random = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(random);
  return base64url(random.buffer as ArrayBuffer);
}
