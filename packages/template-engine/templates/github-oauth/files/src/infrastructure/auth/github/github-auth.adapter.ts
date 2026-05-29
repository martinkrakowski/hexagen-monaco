import type { AuthProviderPort } from "../../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../../domain/value-objects/user-context";
import type { GitHubUser } from "../../../domain/value-objects/github-user";
import { encryptSession, decryptSession } from "./session-store";
import { mapGitHubUserToUserContext } from "./user-profile-mapper";

export class GitHubAuthAdapter implements AuthProviderPort {
  async validate(sessionToken: string): Promise<UserContext | null> {
    const user = await decryptSession(sessionToken);
    if (!user) return null;
    return mapGitHubUserToUserContext(user);
  }

  async createSession(_user: UserContext): Promise<string> {
    throw new Error(
      "GitHubAuthAdapter.createSession() requires a GitHubUser. " +
        "Use createSessionFromGitHubUser() in the callback route.",
    );
  }

  async createSessionFromGitHubUser(user: GitHubUser): Promise<string> {
    return encryptSession(user);
  }

  async revokeSession(_sessionToken: string): Promise<void> {
    // GitHub access tokens don't expire for OAuth Apps; sessions are stateless blobs.
    // Clearing the cookie in the logout route is sufficient.
  }
}
