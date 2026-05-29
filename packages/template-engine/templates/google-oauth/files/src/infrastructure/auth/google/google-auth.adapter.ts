import type { GoogleUser } from "../../../domain/value-objects/google-user";
import { encryptSession } from "./session-store";
import { GOOGLE_CONFIG } from "./config";

// Thin helper for the OAuth callback: validates the hosted-domain restriction,
// then encrypts the Google user into the session cookie. Validation of an
// existing session happens in middleware via decryptSession + the user-profile
// mapper, so this no longer implements a generic auth port.
export class GoogleAuthAdapter {
  async createSessionFromGoogleUser(user: GoogleUser): Promise<string> {
    // Domain names are case-insensitive (RFC 4343), so compare lower-cased.
    const allowed = GOOGLE_CONFIG.hd?.trim().toLowerCase();
    const actual = user.hd?.trim().toLowerCase();
    if (allowed && actual !== allowed) {
      throw new Error(
        `Account domain '${user.hd ?? "personal"}' is not allowed. ` +
          `Only @${allowed} accounts may sign in.`,
      );
    }
    return encryptSession(user);
  }
}
