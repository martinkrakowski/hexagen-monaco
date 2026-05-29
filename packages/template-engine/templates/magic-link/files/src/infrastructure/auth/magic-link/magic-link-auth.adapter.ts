import type { AuthProviderPort } from "../../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../../domain/value-objects/user-context";
import { encryptSession, decryptSession } from "./session-store";

export class MagicLinkAuthAdapter implements AuthProviderPort {
  async validate(sessionToken: string): Promise<UserContext | null> {
    return decryptSession(sessionToken);
  }

  async createSession(user: UserContext): Promise<string> {
    return encryptSession(user);
  }

  async revokeSession(_sessionToken: string): Promise<void> {
    // Sessions are stateless encrypted blobs — clearing the cookie is sufficient.
  }
}
