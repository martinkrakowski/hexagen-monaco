import type { EntraUser } from "../../../domain/value-objects/entra-user";
import { encryptSession } from "./session-store";

// Thin helper for the OAuth callback: encrypts the Entra user into the session
// cookie. Validation of an existing session happens in middleware via
// decryptSession + the user-profile mapper, so this no longer implements a
// generic auth port. For front-channel logout, redirect to
// https://login.microsoftonline.com/{{tenantId}}/oauth2/v2.0/logout from your
// logout route after clearing the cookie.
export class EntraAuthAdapter {
  async createSessionFromEntraUser(user: EntraUser): Promise<string> {
    return encryptSession(user);
  }
}
