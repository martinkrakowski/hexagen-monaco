import type { NextAuthOptions, Profile } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { createNextAuthAdapter, getPlatformStore } from "../../lib/platform";

// GitHub's OAuth profile includes `login` (username) in addition to `name`
// (display name). NextAuth's base Profile type does not model this field.
interface GitHubProfile extends Profile {
  login?: string;
}

/**
 * Best-effort GitHub-login persistence for the jwt callback.
 *
 * NextAuth requires this callback to return a token, so the catch cannot
 * become the callback's return value. The helper returns Result; the
 * callback logs a failure and still returns `token`.
 */
type PersistResult =
  | { success: true; value: string[] }
  | { success: false; error: Error };

/**
 * Injection points for the two writes this seam performs, so the callback can
 * be tested without a database.
 */
export interface GithubSignInDeps {
  setLogin?: (id: string, value: string) => Promise<void>;
  acceptInvites?: (id: string, value: string) => Promise<string[]>;
}

/**
 * Persists the handle and redeems any invitation addressed to it.
 *
 * These belong in ONE seam, in this order. An org invite is keyed by GitHub
 * LOGIN because the invitee had no account when it was written (H1.2); this
 * callback is the moment the login and a user id first exist together, so it
 * is the only place the two can be joined. A second sign-in hook doing the
 * acceptance would be a second place that has to agree about when a handle
 * becomes known -- and the one that runs first on a fresh account would see no
 * handle at all.
 *
 * Order matters: the handle is stored BEFORE invites are redeemed, so a crash
 * between them leaves the invites pending and the next sign-in redeems them.
 * Reversed, a membership could exist for a login the `users` row never
 * recorded. Acceptance itself is one transaction inside the store.
 *
 * Returns the orgs joined, so the callback can log a real outcome rather than
 * a bare success.
 */
export async function persistGithubLogin(
  userId: string,
  login: string,
  deps: GithubSignInDeps = {},
): Promise<PersistResult> {
  const setLogin =
    deps.setLogin ??
    ((id, value) => getPlatformStore().auth.setGithubLogin(id, value));
  const acceptInvites =
    deps.acceptInvites ??
    ((id, value) => getPlatformStore().orgs.acceptInvitesForLogin(id, value));
  try {
    await setLogin(userId, login);
    return { success: true, value: await acceptInvites(userId, login) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export const authOptions: NextAuthOptions = {
  adapter: createNextAuthAdapter(() => getPlatformStore().auth),
  session: { strategy: "jwt" },
  // Moved in-shell 2026-08-25 (P-U2, docs/planning/2026-08-25-login-onboarding-ui-plan.md);
  // /auth/signin remains as a redirect for the old contract.
  pages: { signIn: "/projects/new/login" },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
      authorization: {
        params: {
          // `workflow` is required so published trees may contain
          // .github/workflows/* (the injected sync-integrity CI workflow).
          // The token still never reaches the browser — see the session
          // callback below, which is unchanged.
          scope: "read:user user:email repo workflow",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile, user }) {
      // `account` and `profile` are only present on the initial sign-in —
      // subsequent JWT refreshes skip this block, preserving stored values.
      if (account?.provider === "github" && profile) {
        const githubProfile = profile as GitHubProfile;
        token.accessToken = account.access_token;
        token.login = githubProfile.login;

        // P-A1: persist the handle, then redeem invitations addressed to it
        // (H1.2). `users` stores GitHub's numeric id on
        // `accounts.provider_account_id`, which nobody can type into an invite
        // box, so share-by-handle and org invites need the login itself. This
        // callback is the only place the OAuth profile is in scope, and it
        // fires on initial sign-in only — which is exactly the backfill rule:
        // existing users acquire a login the next time they sign in, and no
        // migration ever calls GitHub.
        //
        // Best-effort: a persistence failure must not block the sign-in that
        // is otherwise complete.
        const userId = user?.id ?? token.sub;
        if (userId && githubProfile.login) {
          const persisted = await persistGithubLogin(
            userId,
            githubProfile.login,
          );
          if (!persisted.success) {
            console.error(
              "[auth] failed to persist github_login",
              persisted.error,
            );
          } else if (persisted.value.length > 0) {
            console.info(
              `[auth] accepted ${persisted.value.length} org invite(s) for ${userId}`,
            );
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      // The GitHub access token is deliberately NOT copied onto the session:
      // it carries `repo` scope and must never reach the browser. Server routes
      // read it from the JWT via `getToken()`. Only non-sensitive identity
      // (login/sub) is exposed to the client.
      if (session.user) {
        session.user.login = token.login;
        session.user.sub = token.sub;
      }
      return session;
    },
  },
};
