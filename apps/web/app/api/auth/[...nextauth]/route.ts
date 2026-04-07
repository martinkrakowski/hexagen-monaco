import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { GET, POST } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
      authorization: {
        params: {
          scope: "repo user:email",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Persist the OAuth access_token to the token right after signin
      if (account) {
        token.accessToken = account.access_token;
        // @ts-ignore - account.user.login exists for GitHub provider
        token.userName = account.user?.login ?? "";
      }
      return token;
    },
    async session({ session, token }) {
      // Send properties to the client, like an access_token from a provider.
      // @ts-ignore - extending session properties
      session.accessToken = token.accessToken as string;
      // @ts-ignore - extending session user properties
      session.user.name = token.userName as string;
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});
