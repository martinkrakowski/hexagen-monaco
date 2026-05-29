import type { DefaultSession } from "next-auth";

// Augments the default session so `session.user.id` is typed across the app.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
