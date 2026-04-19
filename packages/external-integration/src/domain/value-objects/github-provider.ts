import type { AuthProvider } from "./auth-session.js";

export const GITHUB_PROVIDER: AuthProvider = "github";

export function isGitHubProvider(provider: AuthProvider): boolean {
  return provider === "github";
}
