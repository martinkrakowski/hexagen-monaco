import type { GitHubUserResponse } from "./github-client";
import type { GitHubUser } from "../../../domain/value-objects/github-user";
import type { UserContext } from "../../../domain/value-objects/user-context";

export function mapGitHubUser(user: GitHubUserResponse, primaryEmail: string): GitHubUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name ?? user.login,
    email: primaryEmail,
    avatarUrl: user.avatar_url,
    company: user.company ?? undefined,
  };
}

export function mapGitHubUserToUserContext(user: GitHubUser): UserContext {
  return {
    id: String(user.id),
    email: user.email,
    name: user.name,
    roles: ["user"],
    avatarUrl: user.avatarUrl,
  };
}
