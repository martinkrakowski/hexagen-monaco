import type { Config } from "drizzle-kit";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  throw new Error(
    "SUPABASE_DB_URL is required. Set it in .env.local (see .env.supabase.example).",
  );
}

export default {
  schema: "./src/infrastructure/supabase/drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
