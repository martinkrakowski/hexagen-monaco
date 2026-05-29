import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Apply pending Drizzle migrations. Run with: yarn migrate
async function main(): Promise<void> {
  const migrationClient = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
  await migrationClient.end();
}

main()
  .then(() => console.log("✅ Migrations applied"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
