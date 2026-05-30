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

// Cache the *promise* of the checkpointer (not the resolved instance).
// The dynamic import + setup() inside each factory is async, so two
// concurrent first-callers would otherwise both pass the `if` guard,
// both `await import(...)`, and both run setup() — opening duplicate
// connection pools or registering duplicate Redis indexes. Holding the
// in-flight promise serialises them onto one resolution.
type GlobalCache = typeof globalThis & {
  [CACHE_KEY]?: Promise<BaseCheckpointSaver>;
};

async function resolveCheckpointer(): Promise<BaseCheckpointSaver> {
  const choice = (process.env.LANGGRAPH_CHECKPOINTER ?? "memory").toLowerCase();
  switch (choice) {
    case "memory":
      return createMemoryCheckpointer();
    case "supabase": {
      const { createSupabaseCheckpointer } = await import(
        "./supabase-checkpointer"
      );
      return createSupabaseCheckpointer();
    }
    case "postgres": {
      const { createPostgresCheckpointer } = await import(
        "./postgres-checkpointer"
      );
      return createPostgresCheckpointer();
    }
    case "redis": {
      const { createRedisCheckpointer } = await import("./redis-checkpointer");
      return createRedisCheckpointer();
    }
    default:
      // Unknown values used to fall through to the memory branch, which
      // silently dropped persistence in production for typos like
      // "postgress". Fail loud instead — the env var is operator-set, so
      // misconfiguration should be obvious at boot.
      throw new Error(
        `Unknown LANGGRAPH_CHECKPOINTER value "${process.env.LANGGRAPH_CHECKPOINTER}". Expected one of: memory, supabase, postgres, redis.`,
      );
  }
}

export function getCheckpointer(): Promise<BaseCheckpointSaver> {
  const g = globalThis as GlobalCache;
  if (g[CACHE_KEY]) return g[CACHE_KEY];
  g[CACHE_KEY] = resolveCheckpointer().catch((err) => {
    // Drop the failed promise so the next caller can retry on a freshly
    // applied env var instead of replaying the original boot-time error.
    delete g[CACHE_KEY];
    throw err;
  });
  return g[CACHE_KEY];
}

/** Test/dev hook: drop the cached checkpointer so the next call resolves fresh. */
export function resetCheckpointerCache(): void {
  const g = globalThis as GlobalCache;
  delete g[CACHE_KEY];
}
