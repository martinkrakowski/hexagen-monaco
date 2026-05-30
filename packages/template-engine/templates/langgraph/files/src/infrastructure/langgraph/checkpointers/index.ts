import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createMemoryCheckpointer } from "./memory-checkpointer";

/**
 * Resolve the configured checkpointer at boot. Each non-memory backend is
 * imported lazily so projects that didn't generate that template file (or
 * didn't install the matching driver package) don't blow up at module
 * load — the import only runs when LANGGRAPH_CHECKPOINTER actually
 * selects it.
 *
 * The cache lives on `globalThis` rather than as a plain module-scoped
 * `let` so Next.js Fast Refresh / HMR (which reloads modules but keeps
 * the process alive) reuses the same connection pool across reloads.
 * The PrismaClient-in-dev pattern, applied here. Without it, every code
 * edit in dev would leak a fresh PostgresSaver / RedisSaver and you'd
 * exhaust the database connection limit within a handful of saves.
 *
 * The install-time question wires the matching template file into the
 * project; if you change LANGGRAPH_CHECKPOINTER later you must also add
 * the corresponding driver package and template file by re-running the
 * generator with the new answer, otherwise the import will fail with a
 * clear "module not found" instead of a silent fallback.
 */
const CACHE_KEY = Symbol.for("hexagen.langgraph.checkpointer");

type GlobalCache = typeof globalThis & {
  [CACHE_KEY]?: BaseCheckpointSaver;
};

export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  const g = globalThis as GlobalCache;
  if (g[CACHE_KEY]) return g[CACHE_KEY];
  const choice = (process.env.LANGGRAPH_CHECKPOINTER ?? "memory").toLowerCase();
  let instance: BaseCheckpointSaver;
  switch (choice) {
    case "supabase": {
      const { createSupabaseCheckpointer } = await import(
        "./supabase-checkpointer"
      );
      instance = await createSupabaseCheckpointer();
      break;
    }
    case "postgres": {
      const { createPostgresCheckpointer } = await import(
        "./postgres-checkpointer"
      );
      instance = await createPostgresCheckpointer();
      break;
    }
    case "redis": {
      const { createRedisCheckpointer } = await import("./redis-checkpointer");
      instance = await createRedisCheckpointer();
      break;
    }
    case "memory":
    default:
      instance = createMemoryCheckpointer();
      break;
  }
  g[CACHE_KEY] = instance;
  return instance;
}

/** Test/dev hook: drop the cached checkpointer so the next call resolves fresh. */
export function resetCheckpointerCache(): void {
  const g = globalThis as GlobalCache;
  delete g[CACHE_KEY];
}
