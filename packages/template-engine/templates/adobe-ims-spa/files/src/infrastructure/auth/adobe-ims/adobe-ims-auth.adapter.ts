import type { UserContext } from "../../../domain/value-objects/user-context";
import type { IMSTokens } from "../../../domain/ports/out/ims-auth.port";
import { IMSClient } from "./ims-client";
import { IMS_CONFIG } from "./config";
import { encryptTokens, decryptTokens } from "./token-store";
import { mapIMSProfileToUserContext } from "./user-profile-mapper";

// Session-related helpers for Adobe IMS. The session cookie's value is the
// encrypted IMSTokens blob — validation requires a Microsoft Graph-style
// round-trip to IMS to fetch the current profile and (optionally) refresh the
// access token. This used to implement the generic AuthProviderPort, but each
// auth provider now owns its own middleware + helpers end-to-end.

const imsClient = new IMSClient();

export class AdobeIMSAuthAdapter {
  // Resolves the session cookie value into a UserContext. Used by middleware,
  // by getCurrentUser, and by /api/auth/me. Auto-refreshes the access token
  // when within the configured refresh window.
  async validate(sessionToken: string): Promise<UserContext | null> {
    const tokens = await decryptTokens(sessionToken);
    if (!tokens) return null;

    if (
      IMS_CONFIG.autoRefresh &&
      tokens.expiresAt - Date.now() < IMS_CONFIG.refreshWindowSeconds * 1000
    ) {
      if (!tokens.refreshToken) return null;
      try {
        const refreshed = await imsClient.refreshToken(tokens.refreshToken);
        const profile = await imsClient.fetchProfile(refreshed.accessToken);
        return mapIMSProfileToUserContext(profile);
      } catch {
        return null;
      }
    }

    try {
      const profile = await imsClient.fetchProfile(tokens.accessToken);
      return mapIMSProfileToUserContext(profile);
    } catch {
      return null;
    }
  }

  async createSessionFromTokens(tokens: IMSTokens): Promise<string> {
    return encryptTokens(tokens);
  }

  async revokeSession(sessionToken: string): Promise<void> {
    const tokens = await decryptTokens(sessionToken);
    if (!tokens) return;
    await imsClient.revokeToken(tokens.accessToken);
  }
}
