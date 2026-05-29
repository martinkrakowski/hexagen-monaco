import { GOOGLE_CONFIG, GOOGLE_ENDPOINTS } from "./config";

export interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  hd?: string;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CONFIG.clientId,
    redirect_uri: GOOGLE_CONFIG.redirectUri,
    response_type: "code",
    scope: GOOGLE_CONFIG.scopes.join(" "),
    state,
    access_type: "online",
    prompt: "select_account",
  });
  if (GOOGLE_CONFIG.hd) params.set("hd", GOOGLE_CONFIG.hd);
  return `${GOOGLE_ENDPOINTS.authorize}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_ENDPOINTS.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CONFIG.clientId,
      client_secret: GOOGLE_CONFIG.clientSecret,
      redirect_uri: GOOGLE_CONFIG.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<GoogleTokenResponse>;
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_ENDPOINTS.userinfo, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Google userinfo fetch failed (${res.status})`);
  }

  return res.json() as Promise<GoogleUserInfo>;
}
