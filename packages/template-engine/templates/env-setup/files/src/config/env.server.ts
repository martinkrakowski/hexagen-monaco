import { z } from "zod";

/**
 * Server-only environment. Importing this from a client component is a mistake —
 * keep all non-`NEXT_PUBLIC_` vars here so they never reach the browser bundle.
 *
 * Validation runs at import time (server startup), so a misconfigured env fails
 * fast with a readable message instead of a cryptic error deep in a request.
 */

// Driven by the env-setup `strict_validation` answer: when true, a missing or
// invalid var throws at startup; when false, it logs a warning and falls back
// to schema defaults.
const STRICT_ENV_VALIDATION = "{strict_validation}" === "true";

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  // Installed templates extend this schema with their own server-only vars
  // (e.g. XAI_API_KEY, AUTH_SESSION_SECRET, SUPABASE_SERVICE_ROLE_KEY).
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => "  - " + issue.path.join(".") + ": " + issue.message)
    .join("\n");
}

function loadServerEnv(): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  const message =
    "\nEnvironment validation failed:\n" +
    formatIssues(parsed.error) +
    "\n\nSee .env.example for the required variables.\n";

  if (STRICT_ENV_VALIDATION) throw new Error(message);

  console.warn(message);
  // Non-strict fallback: keep the process alive using schema defaults.
  return ServerEnvSchema.parse({ NODE_ENV: process.env.NODE_ENV });
}

export const serverEnv = loadServerEnv();
