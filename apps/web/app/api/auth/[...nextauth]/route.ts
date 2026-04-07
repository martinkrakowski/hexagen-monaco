import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  });
};

export async function GET(request: NextRequest, context: unknown) {
  const handler = await resolveHandler();
  return handler(request, context);
}

export async function POST(request: NextRequest, context: unknown) {
  const handler = await resolveHandler();
  return handler(request, context);
}
