import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/**
 * Supabase-hosted Postgres checkpointer. Uses the same `PostgresSaver`
 * as the plain-postgres backend — Supabase is just managed Postgres —
 * but reads the connection URL from `SUPABASE_DB_URL`, which the
 * Supabase template already exports in env.server. This keeps the two
 * connection strings (your app's data DB vs the checkpointer's DB)
 * intentionally separate so you can point them at different databases
 * or schemas if needed.
 *
 * Run `await checkpointer.setup()` once at boot (see
 * checkpointers/index.ts) — PostgresSaver creates the underlying
 * `checkpoints` / `checkpoint_writes` tables on first use.
 */
export async function createSupabaseCheckpointer(): Promise<PostgresSaver> {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Supabase checkpointer selected but neither SUPABASE_DB_URL nor DATABASE_URL is set. Set SUPABASE_DB_URL=postgresql://… in your env.",
    );
  }
  const checkpointer = PostgresSaver.fromConnString(url);
  await checkpointer.setup();
  return checkpointer;
}
