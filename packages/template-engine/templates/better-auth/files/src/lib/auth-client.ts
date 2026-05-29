"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Typed client for client components — exports the useSession hook. Import
// { signIn, signUp, signOut, useSession } from here. baseURL defaults to the
// current origin. For server-side auth, call the server instance in src/lib/auth.ts.
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
