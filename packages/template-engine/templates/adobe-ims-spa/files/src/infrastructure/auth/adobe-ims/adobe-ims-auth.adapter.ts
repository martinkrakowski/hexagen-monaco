import type { UserContext } from "../../../domain/value-objects/user-context";
import type { IMSTokens } from "../../../domain/ports/out/ims-auth.port";
import { IMSClient } from "./ims-client";
import { IMS_CONFIG } from "./config";
import { encryptTokens, decryptTokens } from "./token-store";
import { mapIMSProfileToUserContext } from "./user-profile-mapper";

// Session-related helpers for Adobe IMS. The session cookie's value is the
// encrypted IMSTokens blob — validation requires a round-trip to IMS to fetch
// the current profile and (optionally) refresh the access token.

const imsClient = new IMSClient();

// validate() returns the resolved user and, when a refresh fired, the new
// encrypted IMSTokens blob the caller should persist back to the cookie.
// Returns null on any validation/refresh failure.
//
// Concurrent-refresh note: two simultaneous in-window requests will both
// refresh. The first Set-Cookie response wins; the second is harmless under
// Adobe IMS's refresh-token rotation policy (the previous refresh token
// remains valid through one rotation cycle). Strict single-flight refresh
// would require a shared server-side store, which intentionally isn't part of
// a stateless cookie template.
export interface ValidatedSession {
  readonly user: UserContext;
  readonly refreshedToken?: string;
}

export class AdobeIMSAuthAdapter {
  async validate(sessionToken: string): Promise<ValidatedSession | null> {
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
        // Encrypt the full refreshed bundle so the new refresh_token (Adobe
        // rotates it on every exchange) is persisted, not just the access token.
        const refreshedToken = await encryptTokens(refreshed);
        return {
          user: mapIMSProfileToUserContext(profile),
          refreshedToken,
        };
      } catch {
        return null;
      }
    }

    try {
      const profile = await imsClient.fetchProfile(tokens.accessToken);
      return { user: mapIMSProfileToUserContext(profile) };
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
