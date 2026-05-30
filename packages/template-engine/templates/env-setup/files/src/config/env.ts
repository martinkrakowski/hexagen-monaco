// Central, typed environment access.
//
// - Server code: import { serverEnv } from "./env.server" (or this barrel).
// - Client/browser code: import { clientEnv } from "./env.client".
//
// Do NOT import env.server from a client component — it holds secrets and the
// bundler cannot strip them safely.
//
// Framework: {framework}
export { serverEnv, type ServerEnv } from "./env.server";
export { clientEnv, type ClientEnv } from "./env.client";
