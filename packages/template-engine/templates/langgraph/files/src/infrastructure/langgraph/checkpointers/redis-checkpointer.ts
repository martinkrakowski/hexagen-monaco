import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";

/**
 * Redis-backed checkpointer. Useful when you've already installed the
 * bullmq template (which provisions a Redis connection + URL) and want
 * graph state to share that infrastructure. Cheap to read, but writes
 * fan out per checkpoint — keep an eye on Redis memory if you store
 * heavy intermediate state in `messages` or similar reducers.
 */
export async function createRedisCheckpointer(): Promise<RedisSaver> {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "Redis checkpointer selected but REDIS_URL is not set. Install the bullmq template (which sets REDIS_URL) or define it manually.",
    );
  }
  // RedisSaver.fromUrl is async — it connects + creates the indexes
  // internally — so the result must be awaited before .setup() runs.
  // Calling .setup() on the un-awaited Promise was a silent bug that
  // would surface as "checkpointer.setup is not a function" the moment
  // the cold-start path hit Redis instead of memory.
  const checkpointer = await RedisSaver.fromUrl(url);
  await checkpointer.setup();
  return checkpointer;
}
