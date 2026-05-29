import type { IMSAuthPort, IMSTokens, IMSUserProfile } from "../../../domain/ports/out/ims-auth.port";
import { IMS_CONFIG, IMS_ENDPOINTS } from "./config";

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

function parseTokenResponse(data: Record<string, unknown>): IMSTokens {
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token ?? ""),
    tokenType: String(data.token_type ?? "bearer"),
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export class IMSClient implements IMSAuthPort {
  async exchangeCode(code: string, verifier: string): Promise<IMSTokens> {
    const res = await postForm(IMS_ENDPOINTS.token, {
      grant_type: "authorization_code",
      client_id: IMS_CONFIG.clientId,
      code,
      redirect_uri: IMS_CONFIG.redirectUri,
      code_verifier: verifier,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`IMS token exchange failed (${res.status}): ${body}`);
    }

    return parseTokenResponse(await res.json() as Record<string, unknown>);
  }

  async refreshToken(refreshToken: string): Promise<IMSTokens> {
    const res = await postForm(IMS_ENDPOINTS.token, {
      grant_type: "refresh_token",
      client_id: IMS_CONFIG.clientId,
      refresh_token: refreshToken,
      scope: IMS_CONFIG.scopes.join(","),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`IMS token refresh failed (${res.status}): ${body}`);
    }

    return parseTokenResponse(await res.json() as Record<string, unknown>);
  }

  async revokeToken(token: string): Promise<void> {
    await postForm(IMS_ENDPOINTS.revoke, {
      token,
      client_id: IMS_CONFIG.clientId,
    });
    // best-effort: ignore revocation errors
  }

  async fetchProfile(accessToken: string): Promise<IMSUserProfile> {
    const res = await fetch(IMS_ENDPOINTS.profile, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`IMS profile fetch failed (${res.status})`);
    }

    const data = await res.json() as Record<string, unknown>;
    return {
      userId: String(data.userId ?? data.sub ?? ""),
      email: String(data.email ?? ""),
      displayName: String(data.displayName ?? data.name ?? ""),
      firstName: data.first_name ? String(data.first_name) : undefined,
      lastName: data.last_name ? String(data.last_name) : undefined,
      countryCode: data.countryCode ? String(data.countryCode) : undefined,
      avatarUrl: data.avatarUrl ? String(data.avatarUrl) : undefined,
      account_type: data.account_type ? String(data.account_type) : undefined,
    };
  }
}
