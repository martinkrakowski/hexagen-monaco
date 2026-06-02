import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    // accessToken is intentionally NOT on Session — the GitHub `repo`-scoped
    // token lives only on the JWT (read server-side via getToken()) and must
    // not be exposed to the browser.
    user: {
      name?: string;
      /** GitHub username (login), distinct from the display name. */
      login?: string;
      /** GitHub numeric user ID — JWT 'sub' claim. Used as AAD for BYOK encryption. */
      sub?: string;
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
