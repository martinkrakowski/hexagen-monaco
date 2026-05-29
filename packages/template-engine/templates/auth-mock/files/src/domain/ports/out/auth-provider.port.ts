import type { UserContext } from "../../value-objects/user-context";

export interface AuthProviderPort {
  /** Validate a session token and return the associated user, or null if invalid/expired. */
  validate(sessionToken: string): Promise<UserContext | null>;
  /** Mint a new session token for the given user. */
  createSession(user: UserContext): Promise<string>;
  /** Invalidate a session token. */
  revokeSession(sessionToken: string): Promise<void>;
}
