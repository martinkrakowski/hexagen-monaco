import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/better-auth";

// PostgreSQL connection for the Better Auth Drizzle adapter.
// Set DATABASE_URL in .env.local. If you use a different database, swap the
// driver/dialect here and regenerate the schema accordingly.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
