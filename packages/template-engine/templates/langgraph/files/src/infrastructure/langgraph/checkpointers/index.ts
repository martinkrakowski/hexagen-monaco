import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createMemoryCheckpointer } from "./memory-checkpointer";

/**
 * Resolve the configured checkpointer at boot. Each non-memory backend is
 * imported lazily so projects that didn't generate that template file (or
 * didn't install the matching driver package) don't blow up at module
 * load — the import only runs when LANGGRAPH_CHECKPOINTER actually
 * selects it.
 *
 * The install-time question wires the matching template file into the
 * project; if you change LANGGRAPH_CHECKPOINTER later you must also add
 * the corresponding driver package and template file by re-running the
 * generator with the new answer, otherwise the import will fail with a
 * clear "module not found" instead of a silent fallback.
 */
let cached: BaseCheckpointSaver | null = null;

export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (cached) return cached;
  const choice = (process.env.LANGGRAPH_CHECKPOINTER ?? "memory").toLowerCase();
  switch (choice) {
    case "supabase": {
      const { createSupabaseCheckpointer } = await import(
        "./supabase-checkpointer"
      );
      cached = await createSupabaseCheckpointer();
      return cached;
    }
    case "postgres": {
      const { createPostgresCheckpointer } = await import(
        "./postgres-checkpointer"
      );
      cached = await createPostgresCheckpointer();
      return cached;
    }
    case "redis": {
      const { createRedisCheckpointer } = await import("./redis-checkpointer");
      cached = await createRedisCheckpointer();
      return cached;
    }
    case "memory":
    default:
      cached = createMemoryCheckpointer();
      return cached;
  }
}

/** Test/dev hook: drop the cached checkpointer so the next call resolves fresh. */
export function resetCheckpointerCache(): void {
  cached = null;
}
