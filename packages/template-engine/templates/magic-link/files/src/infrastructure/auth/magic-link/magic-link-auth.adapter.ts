import type { UserContext } from "../../../domain/value-objects/user-context";
import { encryptSession } from "./session-store";

// Thin helper for the verify route: encrypts the UserContext into the session
// cookie. Validation of an existing session happens in middleware via
// decryptSession, so this no longer implements a generic auth port.
export class MagicLinkAuthAdapter {
  async createSession(user: UserContext): Promise<string> {
    return encryptSession(user);
  }
}
