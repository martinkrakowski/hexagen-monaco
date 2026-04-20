import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      name?: string;
      /** GitHub username (login), distinct from the display name. */
      login?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    /** GitHub username captured from profile.login during sign-in. */
    login?: string;
  }
}
