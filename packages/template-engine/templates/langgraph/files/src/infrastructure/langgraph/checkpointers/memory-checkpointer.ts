import { MemorySaver } from "@langchain/langgraph";

/**
 * In-process checkpoint store. Fine for tests, local dev, and
 * stateless production deployments where you don't need cross-request
 * resume — pick redis / supabase / postgres for those. Memory state is
 * lost on restart and not shared between Node processes, which is the
 * right default for a "Hello, world" graph.
 */
export function createMemoryCheckpointer(): MemorySaver {
  return new MemorySaver();
}
