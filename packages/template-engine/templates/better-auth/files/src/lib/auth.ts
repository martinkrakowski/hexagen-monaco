import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";

// Session lifetime in seconds (from the session_expiry_days answer).
const SESSION_EXPIRY_SECONDS = Number("{session_expiry_days}") * 24 * 60 * 60;

// The single Better Auth server instance. Import { auth } from here in route
// handlers and server components — never import "better-auth" directly elsewhere.
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // TODO: wire your database adapter ("{database}"). See https://www.better-auth.com/docs/adapters
  // e.g. import { prismaAdapter } from "better-auth/adapters/prisma";
  //      database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
  session: {
    expiresIn: SESSION_EXPIRY_SECONDS,
  },
  // Better Auth's built-in rate limiter (from the rate_limiting answer).
  rateLimit: {
    enabled: "{rate_limiting}" === "true",
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // TODO: deliver the link via your email transport (e.g. Resend).
        console.log("[better-auth] magic link for " + email + ": " + url);
      },
    }),
  ],
});
