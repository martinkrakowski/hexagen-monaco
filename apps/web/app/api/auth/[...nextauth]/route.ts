import type { NextRequest } from "next/server";
import type { Profile } from "next-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next.js 15 App Router uses async params for dynamic segments.
// This must match the shape checked by the generated .next/types file.
type RouteContext = {
  params: Promise<{ nextauth: string[] }>;
};

// GitHub's OAuth profile includes `login` (username) in addition to `name`
// (display name). NextAuth's base Profile type does not model this field.
interface GitHubProfile extends Profile {
  login?: string;
}

const resolveHandler = async () => {
  const [{ default: NextAuth }, { default: GitHubProvider }] =
    await Promise.all([
      import("next-auth"),
      import("next-auth/providers/github"),
    ]);

  return NextAuth({
    providers: [
      GitHubProvider({
        clientId: process.env.GITHUB_ID ?? "",
        clientSecret: process.env.GITHUB_SECRET ?? "",
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
        session.accessToken = token.accessToken;
        if (session.user) {
          session.user.login = token.login;
        }
        return session;
      },
    },
  });
};

export async function GET(request: NextRequest, context: RouteContext) {
  const handler = await resolveHandler();
  return handler(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const handler = await resolveHandler();
  return handler(request, context);
}
