import type { AuthProviderPort } from "../../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../../domain/value-objects/user-context";
import type { IMSTokens } from "../../../domain/ports/out/ims-auth.port";
import { IMSClient } from "./ims-client";
import { IMS_CONFIG } from "./config";
import { encryptTokens, decryptTokens } from "./token-store";
import { mapIMSProfileToUserContext } from "./user-profile-mapper";

// Session token format: encrypted IMSTokens blob (base64url.base64url)
// The authService session token IS the encrypted token bundle.

const imsClient = new IMSClient();

export class AdobeIMSAuthAdapter implements AuthProviderPort {
  async validate(sessionToken: string): Promise<UserContext | null> {
    const tokens = await decryptTokens(sessionToken);
    if (!tokens) return null;

    if (IMS_CONFIG.autoRefresh && tokens.expiresAt - Date.now() < IMS_CONFIG.refreshWindowSeconds * 1000) {
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

  async createSession(user: UserContext): Promise<string> {
    // Called after a successful code exchange; the encrypted token blob
    // is stored separately in the token cookie. This session token is a
    // lightweight reference — for IMS we store the full encrypted blob.
    // Callers that have the tokens should use createSessionFromTokens instead.
    throw new Error(
      "AdobeIMSAuthAdapter.createSession() requires tokens. " +
        "Use createSessionFromTokens() in the callback route.",
    );
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
