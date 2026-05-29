import type { AuthProviderPort } from "../../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../../domain/value-objects/user-context";
import type { EntraUser } from "../../../domain/value-objects/entra-user";
import { encryptSession, decryptSession } from "./session-store";
import { mapEntraUserToUserContext } from "./user-profile-mapper";

export class EntraAuthAdapter implements AuthProviderPort {
  async validate(sessionToken: string): Promise<UserContext | null> {
    const user = await decryptSession(sessionToken);
    if (!user) return null;
    return mapEntraUserToUserContext(user);
  }

  async createSession(_user: UserContext): Promise<string> {
    throw new Error(
      "EntraAuthAdapter.createSession() requires an EntraUser. " +
        "Use createSessionFromEntraUser() in the callback route.",
    );
  }

  async createSessionFromEntraUser(user: EntraUser): Promise<string> {
    return encryptSession(user);
  }

  async revokeSession(_sessionToken: string): Promise<void> {
    // Sessions are stateless encrypted blobs — clearing the cookie is sufficient.
    // For front-channel logout, redirect the user to the Entra logout endpoint:
    // https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/logout
  }
}
