import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Drizzle client over the Supabase Postgres connection. Set SUPABASE_DB_URL
// (Project Settings → Database → Connection string). prepare:false suits the
// Supabase connection pooler.
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  throw new Error(
    "SUPABASE_DB_URL is required. Set it in .env.local (see .env.supabase.example).",
  );
}

const queryClient = postgres(dbUrl, { prepare: false });

export const db = drizzle(queryClient, { schema });
