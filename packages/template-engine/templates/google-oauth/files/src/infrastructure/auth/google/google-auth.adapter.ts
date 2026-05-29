import type { AuthProviderPort } from "../../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../../domain/value-objects/user-context";
import type { GoogleUser } from "../../../domain/value-objects/google-user";
import { encryptSession, decryptSession } from "./session-store";
import { mapGoogleUserToUserContext } from "./user-profile-mapper";
import { GOOGLE_CONFIG } from "./config";

export class GoogleAuthAdapter implements AuthProviderPort {
  async validate(sessionToken: string): Promise<UserContext | null> {
    const user = await decryptSession(sessionToken);
    if (!user) return null;
    return mapGoogleUserToUserContext(user);
  }

  async createSession(_user: UserContext): Promise<string> {
    throw new Error(
      "GoogleAuthAdapter.createSession() requires a GoogleUser. " +
        "Use createSessionFromGoogleUser() in the callback route.",
    );
  }

  async createSessionFromGoogleUser(user: GoogleUser): Promise<string> {
    // Enforce hosted-domain restriction at session creation time
    if (GOOGLE_CONFIG.hd && user.hd !== GOOGLE_CONFIG.hd) {
      throw new Error(
        `Account domain '${user.hd ?? "personal"}' is not allowed. ` +
          `Only @${GOOGLE_CONFIG.hd} accounts may sign in.`,
      );
    }
    return encryptSession(user);
  }

  async revokeSession(_sessionToken: string): Promise<void> {
    // Sessions are stateless encrypted blobs — no server-side revocation needed.
    // Clearing the cookie in the logout route is sufficient.
  }
}
