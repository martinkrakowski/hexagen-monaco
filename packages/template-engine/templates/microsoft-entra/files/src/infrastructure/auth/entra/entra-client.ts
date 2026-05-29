import { ENTRA_CONFIG, ENTRA_ENDPOINTS } from "./config";

export interface EntraTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

export interface EntraGraphProfile {
  id: string;
  userPrincipalName: string;
  displayName: string;
  mail?: string;
  otherMails?: string[];
}

export interface EntraGroupEntry {
  id: string;
  displayName?: string;
  "@odata.type"?: string;
}

export function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: ENTRA_CONFIG.clientId,
    response_type: "code",
    redirect_uri: ENTRA_CONFIG.redirectUri,
    response_mode: "query",
    scope: ENTRA_CONFIG.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${ENTRA_ENDPOINTS.authorize}?${params.toString()}`;
}

export async function exchangeCode(code: string, verifier: string): Promise<EntraTokenResponse> {
  const res = await fetch(ENTRA_ENDPOINTS.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ENTRA_CONFIG.clientId,
      client_secret: ENTRA_CONFIG.clientSecret,
      code,
      redirect_uri: ENTRA_CONFIG.redirectUri,
      code_verifier: verifier,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Entra token exchange failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<EntraTokenResponse>;
}

export async function fetchProfile(accessToken: string): Promise<EntraGraphProfile> {
  const res = await fetch(ENTRA_ENDPOINTS.me, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Entra Graph /me failed (${res.status})`);
  return res.json() as Promise<EntraGraphProfile>;
}

export async function fetchGroupIds(accessToken: string): Promise<string[]> {
  const res = await fetch(ENTRA_ENDPOINTS.memberOf, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Non-fatal: Graph may return 403 if the app doesn't have GroupMember.Read.All
    console.warn(`[entra] /memberOf returned ${res.status} — group claims will be empty`);
    return [];
  }
  const data = await res.json() as { value: EntraGroupEntry[] };
  return data.value
    .filter((g) => g["@odata.type"] === "#microsoft.graph.group")
    .map((g) => g.id);
}
