import type { NextAuthOptions, Profile } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { createNextAuthAdapter, getPlatformStore } from "../../lib/platform";

// GitHub's OAuth profile includes `login` (username) in addition to `name`
// (display name). NextAuth's base Profile type does not model this field.
interface GitHubProfile extends Profile {
  login?: string;
}

export const authOptions: NextAuthOptions = {
  adapter: createNextAuthAdapter(() => getPlatformStore().auth),
  session: { strategy: "jwt" },
  pages: { signIn: "/auth/signin" },
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

        // P-A1: persist the handle. `users` stores GitHub's numeric id on
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
          try {
            await getPlatformStore().auth.setGithubLogin(
              userId,
              githubProfile.login,
            );
          } catch (error) {
            console.error("[auth] failed to persist github_login", error);
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
