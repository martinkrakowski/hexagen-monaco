import type { GitHubUser } from "./github-user";
import { encryptSession } from "./session-store";

// Thin helper for the OAuth callback: encrypts the GitHub user into the session
// cookie. Validation of an existing session happens in middleware via
// decryptSession + the user-profile mapper, so this no longer implements a
// generic auth port.
export class GitHubAuthAdapter {
  async createSessionFromGitHubUser(user: GitHubUser): Promise<string> {
    return encryptSession(user);
  }
}
