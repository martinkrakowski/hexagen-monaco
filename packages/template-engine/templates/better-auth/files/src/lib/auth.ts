import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";
import * as schema from "../db/schema/better-auth";

// Session lifetime in seconds (from the session_expiry_days answer).
const SESSION_EXPIRY_SECONDS = Number("{session_expiry_days}") * 24 * 60 * 60;

// Providers selected at setup: {providers}.
// The template engine can't conditionally emit code, so each provider activates
// at runtime only when its credentials are present — an email/password-only
// deployment enables no social providers and needs no extra secrets.
const socialProviders: Record<
  string,
  { clientId: string; clientSecret: string }
> = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}

// Magic link is opt-in: set BETTER_AUTH_MAGIC_LINK=true after implementing
// delivery in sendMagicLink() below. Off by default, so it adds no surface.
const plugins: ReturnType<typeof magicLink>[] = [];
if (process.env.BETTER_AUTH_MAGIC_LINK === "true") {
  plugins.push(
    magicLink({
      sendMagicLink: () => {
        // TODO: deliver the link via your email transport (e.g. Resend).
        // Rejects until implemented — never log the URL or recipient (PII + bearer token).
        return Promise.reject(
          new Error(
            "Magic link delivery is not configured. Implement sendMagicLink() in src/lib/auth.ts with your email transport.",
          ),
        );
      },
    }),
  );
}

// The single Better Auth server instance. Import { auth } from here in route
// handlers and server components — never import "better-auth" directly elsewhere.
//
// This scaffold targets the "{database}" answer with the Drizzle (PostgreSQL)
// adapter and the schema in src/db. For Prisma or Kysely, swap the adapter
// import and regenerate the schema: npx @better-auth/cli generate
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders,
  session: {
    expiresIn: SESSION_EXPIRY_SECONDS,
  },
  // Better Auth's built-in rate limiter (from the rate_limiting answer).
  rateLimit: {
    enabled: "{rate_limiting}" === "true",
  },
  plugins,
});
