import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Typed client for browser and server components. Import { signIn, signUp,
// signOut, useSession } from here. baseURL defaults to the current origin.
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
