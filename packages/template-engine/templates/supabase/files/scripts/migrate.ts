import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Apply pending Drizzle migrations. Run with: yarn migrate
async function main(): Promise<void> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error(
      "SUPABASE_DB_URL is required. Set it in .env.local (see .env.supabase.example).",
    );
  }
  const migrationClient = postgres(dbUrl, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
  await migrationClient.end();
}

main()
  .then(() => console.log("✅ Migrations applied"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
