import { z } from "zod";

/**
 * Public environment — only `NEXT_PUBLIC_`-prefixed vars belong here, because
 * everything in this file is shipped to the browser. Never add a secret.
 */
const ClientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  // NEXT_PUBLIC_* vars added by other templates go here.
});

export type ClientEnv = z.infer<typeof ClientEnvSchema>;

// Read each var explicitly (not a `process.env` spread) so the bundler can
// statically inline NEXT_PUBLIC_* values into the client build.
export const clientEnv: ClientEnv = ClientEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
