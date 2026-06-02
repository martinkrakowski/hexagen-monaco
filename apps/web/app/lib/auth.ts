import type { NextAuthOptions, Profile } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

// GitHub's OAuth profile includes `login` (username) in addition to `name`
// (display name). NextAuth's base Profile type does not model this field.
interface GitHubProfile extends Profile {
  login?: string;
}

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
      authorization: {
        params: {
          scope: "read:user user:email repo",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // `account` and `profile` are only present on the initial sign-in —
      // subsequent JWT refreshes skip this block, preserving stored values.
      if (account?.provider === "github" && profile) {
        const githubProfile = profile as GitHubProfile;
        token.accessToken = account.access_token;
        token.login = githubProfile.login;
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
