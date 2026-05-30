import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/**
 * Direct-Postgres checkpointer (no Supabase indirection). Reads
 * `DATABASE_URL` — bring your own pooler, connection limits, and SSL
 * config in the URL. The underlying `PostgresSaver` will create its
 * `checkpoints` / `checkpoint_writes` tables on first use via
 * `setup()`, called once at boot in checkpointers/index.ts.
 */
export async function createPostgresCheckpointer(): Promise<PostgresSaver> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Postgres checkpointer selected but DATABASE_URL is not set.",
    );
  }
  const checkpointer = PostgresSaver.fromConnString(url);
  await checkpointer.setup();
  return checkpointer;
}
