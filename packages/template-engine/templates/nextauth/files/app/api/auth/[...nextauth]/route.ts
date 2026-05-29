import { handlers } from "../../../../src/auth";

// Auth.js catch-all handler — serves /api/auth/* (signin, callback, signout, session, …).
export const { GET, POST } = handlers;
