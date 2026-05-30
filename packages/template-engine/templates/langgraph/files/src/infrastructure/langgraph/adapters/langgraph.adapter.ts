import { randomUUID } from "node:crypto";
import type {
  AgentGraphPort,
  GraphConfig,
  GraphEvent,
  GraphInput,
  GraphInvokeResult,
  GraphStateSnapshot,
} from "../../../domain/ports/out/agent-graph.port";
import { getCheckpointer } from "../checkpointers";
import { buildMainGraph } from "../graphs/{graph_type}.graph";

/**
 * The only place that touches the LangGraph SDK. Application code goes
 * through `AgentGraphPort`, so if the SDK's API shifts (and it does)
 * only this file needs to update.
 *
 * The compiled graph is memoised because compilation isn't free —
 * StateGraph builds an internal topology each call — and the checkpointer
 * is configured once at module load. The cache lives on `globalThis` so
 * Next.js Fast Refresh / HMR (which re-evaluates this module on edits)
 * doesn't drop the existing compiled-graph + checkpointer connection
 * pool and start a fresh one. Same singleton-across-reloads pattern as
 * the checkpointer factory.
 */
type CompiledGraph = ReturnType<typeof buildMainGraph>;
const COMPILED_KEY = Symbol.for("hexagen.langgraph.compiledGraph");

type GlobalCompiledCache = typeof globalThis & {
  [COMPILED_KEY]?: CompiledGraph;
};

async function compileOnce(): Promise<CompiledGraph> {
  const g = globalThis as GlobalCompiledCache;
  if (g[COMPILED_KEY]) return g[COMPILED_KEY];
  const checkpointer = await getCheckpointer();
  const instance = buildMainGraph(checkpointer);
  g[COMPILED_KEY] = instance;
  return instance;
}

export class LangGraphAdapter implements AgentGraphPort {
  async invoke(
    input: GraphInput,
    config?: GraphConfig,
  ): Promise<GraphInvokeResult> {
    const threadId = input.threadId ?? randomUUID();
    try {
      const graph = await compileOnce();
      const result = await graph.invoke(
        { input: input.prompt, threadId },
        {
          configurable: { thread_id: threadId },
          recursionLimit: config?.maxSteps ?? 25,
        },
      );
      if (result.errorMessage) {
        return {
          ok: false,
          error: {
            kind: "node-failed",
            message: result.errorMessage,
          },
        };
      }
      return {
        ok: true,
        value: {
          result: result.output ?? "",
          steps: result.steps ?? [],
          threadId,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        },
      };
    }
  }

  async resume(
    threadId: string,
    humanInput: string,
    config?: GraphConfig,
  ): Promise<GraphInvokeResult> {
    try {
      const graph = await compileOnce();
      // Partial state update: ONLY humanInput. Omitting `input` here
      // lets the checkpointer restore the original prompt from the
      // paused thread instead of last-write-wins-clobbering it.
      const result = await graph.invoke(
        { humanInput },
        {
          configurable: { thread_id: threadId },
          recursionLimit: config?.maxSteps ?? 25,
        },
      );
      if (result.errorMessage) {
        return {
          ok: false,
          error: { kind: "node-failed", message: result.errorMessage },
        };
      }
      return {
        ok: true,
        value: {
          result: result.output ?? "",
          steps: result.steps ?? [],
          threadId,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        },
      };
    }
  }

  async *stream(
    input: GraphInput,
    config?: GraphConfig,
  ): AsyncIterable<GraphEvent> {
    const threadId = input.threadId ?? randomUUID();
    const graph = await compileOnce();
    const iter = await graph.stream(
      { input: input.prompt, threadId },
      {
        configurable: { thread_id: threadId },
        recursionLimit: config?.maxSteps ?? 25,
        streamMode: "updates",
      },
    );
    for await (const chunk of iter) {
      // streamMode "updates" yields one entry per node with the partial state
      // diff produced by that node. We forward it as a "node_end" event so
      // SSE consumers can observe progress without coupling to the SDK shape.
      for (const [nodeName, payload] of Object.entries(
        chunk as Record<string, unknown>,
      )) {
        yield { type: "node_end", data: { node: nodeName, update: payload } };
      }
    }
    yield { type: "done", data: { threadId } };
  }

  async getState(threadId: string): Promise<GraphStateSnapshot | null> {
    const graph = await compileOnce();
    const snapshot = await graph.getState({
      configurable: { thread_id: threadId },
    });
    if (!snapshot) return null;
    return {
      threadId,
      values: snapshot.values as Record<string, unknown>,
      next: snapshot.next ?? [],
    };
  }
}

/** Singleton — keep one compiled-graph instance per process. */
export const langGraphAdapter = new LangGraphAdapter();
