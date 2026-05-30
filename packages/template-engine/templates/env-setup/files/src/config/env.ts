// Typed environment access, split by runtime.
//
// This barrel re-exports TYPES ONLY (erased at compile time). Re-exporting the
// runtime `serverEnv`/`clientEnv` here would pull env.server.ts — and its
// startup validation — into any client bundle that imports the barrel, running
// server-side validation in the browser. Import the runtime values from the
// specific module instead, so the server/client boundary stays intact:
//
//   - server code: import { serverEnv } from "./env.server";
//   - client code: import { clientEnv } from "./env.client";
//
// Framework: {framework}
export type { ServerEnv } from "./env.server";
export type { ClientEnv } from "./env.client";
