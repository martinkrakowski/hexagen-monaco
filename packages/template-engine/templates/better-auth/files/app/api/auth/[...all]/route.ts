import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../src/lib/auth";

// Better Auth catch-all handler — serves /api/auth/* (sign-in, callbacks, session, …).
export const { GET, POST } = toNextJsHandler(auth);
