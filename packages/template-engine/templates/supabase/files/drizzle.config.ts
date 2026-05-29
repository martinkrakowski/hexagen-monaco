import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/supabase/drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.SUPABASE_DB_URL! },
} satisfies Config;
