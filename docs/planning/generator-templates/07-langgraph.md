# Template: LangGraph

**Branch:** `feature/generator-template-langgraph` (merged via PR #115)
**Status:** Implemented (v1.0). 24 outputs (15 gated), 5 questions. See PR for details.

## What shipped vs. the plan

The plan called for 8 phases. v1 ships all 8:

- **Phases 1, 2, 4 (always emit):** `AgentGraphPort` (invoke / resume / stream / getState + a lightweight `GraphInvokeResult` discriminant); `GraphStateAnnotation` with append-reducers for `messages` + `steps`, last-write-wins for `input` / `output` / `threadId` / `errorMessage` / `humanInput`; `routeAfterError` / `routeAfterOutput` helpers.
- **Phase 3 (gated on `graph_type`):** Per-graph-type node sets — three nodes per type — for `simple-chain` (input-processor → llm-call → output-formatter) and `research-agent` (planner → researcher (parallel fan-out) → synthesiser). Tagged `<plan>` / `<answers>` AIMessage instances pass context between nodes without widening the state schema.
- **Phase 5 (gated on `graph_type`):** One graph file per type. Adapter imports the chosen graph via `{graph_type}` interpolation; the unused variant's file is never emitted.
- **Phase 6 (gated on `checkpointing`):** Memory backend always; supabase / redis / postgres each emit on demand. The factory dynamic-imports the matching file when `LANGGRAPH_CHECKPOINTER` selects it, throws on unknown values, and caches the in-flight promise on `globalThis` to survive Next.js HMR.
- **Phase 7 (always):** `LangGraphAdapter` is the only file that touches `@langchain/langgraph`; compileOnce caches the compiled-graph promise on `globalThis` to survive HMR and serialise concurrent first-callers. `/api/agent/invoke` route is always-on; `/api/agent/stream` is gated on `streaming=true`.
- **Phase 8 (gated on `human_in_loop=true`):** Emits `human-review.node.ts` + `/api/agent/resume` route. Both example graphs auto-rewire to insert the human-review node and compile with `interruptBefore: ["human-review"]` when `LANGGRAPH_HITL_ENABLED=true` (the env example templates this from the install answer, so a `human_in_loop=true` install is fully functional out-of-the-box). The adapter's `resume(threadId, humanInput)` passes ONLY humanInput as a partial state update so the checkpointer restores the original `input` prompt intact.

### Deferred from the plan

- **`graph_type=none`** — would require a not-equals gate the template engine doesn't support. Defaulting to `simple-chain` matches the template's "ship a working example" intent; users wanting a custom graph edit the emitted file (the "owned by the project" promise).
- **`multi-step-generation` graph type** — the plan doc didn't fully spec the node set; deferred to a follow-up once the shape is settled.

## Test coverage

`packages/template-engine/__tests__/templates/langgraph-emit-shape.test.ts` exercises two install scenarios end-to-end against the real template directory:

- minimal install (defaults: `local`, `memory`, `simple-chain`, no streaming, no HITL) — asserts the 9 always-on files + 4 simple-chain files emit; asserts research-agent nodes, non-memory checkpointers, streaming, and HITL files do NOT emit. Also asserts the `{graph_type}` placeholder in the adapter resolves to `../graphs/simple-chain.graph`.
- full install (`langgraph-cloud`, `supabase`, `research-agent`, streaming, HITL) — asserts research-agent nodes + supabase-checkpointer + streaming + HITL files emit; asserts simple-chain nodes and the other checkpointers do NOT emit.

---

## Purpose

Generates a clean hexagonal LangGraph integration: a typed port interface, state definition, node stubs, graph compilation, checkpointing, and optional streaming. Provides a working reference graph so developers understand the pattern before customizing it. Designed to be useful even as the LangGraph API evolves, since the generated code is owned by the project.

---

## Install-Time Questions

| ID              | Prompt                                       | Type    | Options                                                           | Default        |
| --------------- | -------------------------------------------- | ------- | ----------------------------------------------------------------- | -------------- |
| `deployment`    | LangGraph deployment target?                 | select  | `local`, `langgraph-cloud`, `self-hosted`                         | `local`        |
| `checkpointing` | Checkpointing backend?                       | select  | `memory`, `supabase`, `redis`, `postgres`                         | `memory`       |
| `streaming`     | Enable streaming token output?               | boolean | —                                                                 | `false`        |
| `graph_type`    | Example graph to generate?                   | select  | `simple-chain`, `research-agent`, `multi-step-generation`, `none` | `simple-chain` |
| `human_in_loop` | Include human-in-the-loop interrupt example? | boolean | —                                                                 | `false`        |

---

## Files Generated

```
src/
  domain/
    ports/
      out/
        agent-graph.port.ts       # AgentGraphPort interface

  infrastructure/
    langgraph/
      state/
        graph-state.ts            # TypedDict-style state definition
      nodes/
        <node-name>.node.ts       # One file per graph node
      edges/
        routing.ts                # Conditional edge routing functions
      checkpointers/
        memory-checkpointer.ts    # In-process (dev/test)
        supabase-checkpointer.ts  # (if supabase selected)
        redis-checkpointer.ts     # (if redis selected)
      graphs/
        main.graph.ts             # Compiled graph
      streaming/
        token-stream.ts           # (if streaming=true)
      adapters/
        langgraph.adapter.ts      # Implements AgentGraphPort
      index.ts

app/
  api/
    agent/
      invoke/
        route.ts                  # POST → invoke graph, return result
      stream/                     # (if streaming=true)
        route.ts                  # POST → SSE stream

.env.langgraph.example
```

---

## Generated .env Variables

```env
# LangGraph
LANGGRAPH_DEPLOYMENT=local         # local | cloud | self-hosted

# LangGraph Cloud (if cloud selected)
LANGGRAPH_API_URL=
LANGGRAPH_API_KEY=

# Checkpointing
LANGGRAPH_CHECKPOINTER=memory      # memory | supabase | redis | postgres

# (Redis checkpointer)
# REDIS_URL already set by bullmq template if present

# (Postgres checkpointer)
# SUPABASE_DB_URL already set by supabase template if present
```

---

## Key Design Decisions

**`AgentGraphPort` is the only boundary:** Application code calls `agentGraph.invoke(input)` or `agentGraph.stream(input)`. The graph topology, node count, and LangGraph API version are all infrastructure concerns hidden behind this port. If LangGraph's API changes, only `langgraph.adapter.ts` needs updating.

**State is the central type:** All nodes read from and write to `GraphState`. New nodes are added by extending `GraphState` and writing a new node file — no changes to existing nodes.

**Checkpointer is swapped by env var:** `memory` works in all environments with no dependencies. `supabase` / `redis` / `postgres` activate automatically when the corresponding template is installed and the env var is set.

**Nodes are pure async functions:** Each node file exports `async function nodeNameNode(state: GraphState): Promise<Partial<GraphState>>`. No class, no DI, no side effects on the graph itself. This makes nodes individually unit-testable.

**Human-in-the-loop uses `interrupt()`:** When enabled, the graph compiles with an interrupt before the human-review node. The API route includes a `/resume` endpoint that passes the human's input back to the paused graph via the thread ID.

---

## Phase 1 — Port Interface

**Goal:** Define the contract for the graph — all callers use this interface, never the LangGraph SDK directly.

```typescript
// src/domain/ports/out/agent-graph.port.ts
export interface AgentGraphPort {
  invoke(
    input: GraphInput,
    config?: GraphConfig,
  ): Promise<Result<GraphOutput, GraphError>>;
  stream?(input: GraphInput, config?: GraphConfig): AsyncIterable<GraphEvent>;
  getState(threadId: string): Promise<GraphState | null>;
}

export interface GraphInput {
  prompt: string;
  context?: string;
  threadId?: string;
}
export interface GraphOutput {
  result: string;
  steps: string[];
  threadId: string;
}
export interface GraphConfig {
  maxSteps?: number;
  timeoutMs?: number;
}
export interface GraphEvent {
  type: "token" | "node_start" | "node_end" | "done";
  data: unknown;
}
```

Validation: TypeScript compiles; no implementation yet.

---

## Phase 2 — State Definition

**Goal:** Single typed state object shared across all nodes.

```typescript
// src/infrastructure/langgraph/state/graph-state.ts
import { Annotation } from "@langchain/langgraph";

export const GraphStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => [...a, ...b] }),
  input: Annotation<string>(),
  output: Annotation<string | null>({ default: () => null }),
  steps: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  threadId: Annotation<string>(),
  errorMessage: Annotation<string | null>({ default: () => null }),
});

export type GraphState = typeof GraphStateAnnotation.State;
```

Validation: TypeScript compiles with correct inference of `GraphState` fields.

---

## Phase 3 — Node Implementations

**Goal:** Working nodes for the selected example graph.

`simple-chain` example generates:

- `nodes/input-processor.node.ts` — validates and sanitises the prompt
- `nodes/llm-call.node.ts` — calls `LLMClientPort`, appends result to messages
- `nodes/output-formatter.node.ts` — formats final response

`research-agent` example generates:

- `nodes/planner.node.ts` — breaks task into sub-questions
- `nodes/researcher.node.ts` — calls LLM for each sub-question
- `nodes/synthesiser.node.ts` — combines sub-answers into final result

Each node:

```typescript
export async function llmCallNode(
  state: GraphState,
): Promise<Partial<GraphState>> {
  // ...
  return { messages: [aiMessage], steps: ["llm-call-complete"] };
}
```

Validation: Unit test for each node with a mock `GraphState`.

---

## Phase 4 — Conditional Edge Routing

**Goal:** Type-safe routing functions that direct the graph flow.

```typescript
// src/infrastructure/langgraph/edges/routing.ts
export type RouteDecision = "continue" | "error" | "__end__";

export function routeAfterLLM(state: GraphState): RouteDecision {
  if (state.errorMessage) return "error";
  if (state.output) return "__end__";
  return "continue";
}
```

Validation: Unit test each routing function with different state shapes.

---

## Phase 5 — Graph Compilation

**Goal:** Assembled, compiled graph ready to invoke.

```typescript
// src/infrastructure/langgraph/graphs/main.graph.ts
export function buildMainGraph(checkpointer: BaseCheckpointer) {
  const graph = new StateGraph(GraphStateAnnotation)
    .addNode("input-processor", inputProcessorNode)
    .addNode("llm-call", llmCallNode)
    .addNode("output-formatter", outputFormatterNode)
    .addEdge(START, "input-processor")
    .addEdge("input-processor", "llm-call")
    .addConditionalEdges("llm-call", routeAfterLLM, {
      continue: "output-formatter",
      error: END,
      __end__: END,
    })
    .addEdge("output-formatter", END);

  return graph.compile({ checkpointer });
}
```

Validation: `buildMainGraph(new MemorySaver())` does not throw; `.invoke({ prompt: 'test' })` returns a result.

---

## Phase 6 — Checkpointers

**Goal:** Drop-in checkpointer selection based on env var.

`memory-checkpointer.ts` — wraps `MemorySaver` from `@langchain/langgraph`

`supabase-checkpointer.ts` — uses `@langchain/langgraph-checkpoint-postgres` with `SUPABASE_DB_URL`

`redis-checkpointer.ts` — uses `@langchain/langgraph-checkpoint-redis` with `REDIS_URL`

`checkpointers/index.ts`:

```typescript
export function createCheckpointer(): BaseCheckpointer {
  switch (process.env.LANGGRAPH_CHECKPOINTER) {
    case "supabase":
    case "postgres":
      return new PostgresSaver(pool);
    case "redis":
      return new RedisSaver(redis);
    default:
      return new MemorySaver();
  }
}
```

Validation: Each checkpointer factory constructs without error given correct env vars.

---

## Phase 7 — LangGraph Adapter & API Routes

**Goal:** Wire the compiled graph to `AgentGraphPort` and expose via Next.js API routes.

`langgraph.adapter.ts` implements `AgentGraphPort`:

- `invoke()` → calls `graph.invoke()` with a stable `threadId` (UUID if not provided)
- `stream()` → calls `graph.stream()` and yields `GraphEvent` objects
- `getState()` → calls `graph.getState()` for a given thread ID

`app/api/agent/invoke/route.ts`:

```typescript
POST /api/agent/invoke
Body: { prompt: string, threadId?: string }
Response: { result: string, steps: string[], threadId: string }
```

`app/api/agent/stream/route.ts` (if streaming):

```
POST /api/agent/stream
Body: { prompt: string }
Response: text/event-stream
```

Validation: Integration test for invoke route; SSE test for stream route.

---

## Phase 8 — Human-in-the-Loop (opt-in)

**Goal:** Working interrupt/resume pattern for human review.

Compile the graph with `interruptBefore: ['human-review']`.

Add `app/api/agent/resume/route.ts`:

```typescript
POST /api/agent/resume
Body: { threadId: string, humanInput: string }
```

Resume call: `graph.invoke({ humanInput }, { configurable: { thread_id: threadId } })`

Validation: Integration test — invoke pauses at interrupt; resume continues to completion.

---

## Post-Install Checklist

```
✅ langgraph installed

Next steps:
  1. Install LangGraph package: yarn add @langchain/langgraph @langchain/core
  2. Merge .env.langgraph.example into .env.local
  3. Run: POST /api/agent/invoke with { "prompt": "Hello" } to verify the graph works
  4. Switch LANGGRAPH_CHECKPOINTER=supabase or redis for persistent memory across requests
  5. See src/infrastructure/langgraph/graphs/main.graph.ts to extend the graph
  6. See SETUP.md → LangGraph for multi-turn conversation patterns
```

---

## Template Dependencies

- Required: `llm-adapter` (nodes use `LLMClientPort`)
- Required: `env-setup`
- Soft dependency: `supabase` (enables Supabase/Postgres checkpointer)
- Soft dependency: `bullmq` (enables async graph invocation via job queue)
- Soft dependency: `observability` (structured logging for node execution times)
