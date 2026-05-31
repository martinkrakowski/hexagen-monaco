# LangGraph (`langgraph`)

> Hexagonal LangGraph integration: a typed `AgentGraphPort`, shared `GraphState`, node files,
> conditional edge routing, swap-by-env checkpointers, and Next.js routes — with a working example graph.

|               |                                        |
| ------------- | -------------------------------------- |
| **ID**        | `langgraph`                            |
| **Category**  | LLM / agents                           |
| **Requires**  | `env-setup`, `llm-adapter`             |
| **Conflicts** | none                                   |
| **Branch**    | `feature/generator-template-langgraph` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Wires LangGraph behind a port so the app depends on `AgentGraphPort`, not LangGraph directly.
Ships one of two working example graphs (simple-chain or research-agent) running against your
`llm-adapter`, with checkpointers swappable by env and optional streaming + human-in-the-loop.

## What it scaffolds

- `src/domain/ports/out/agent-graph.port.ts`, `state/graph-state.ts`, `edges/routing.ts`,
  `adapters/langgraph.adapter.ts`, `checkpointers/*`.
- The chosen example graph + its nodes; `app/api/agent/invoke/route.ts` (+ gated `stream`/`resume`).

## Install

`hexagen add langgraph`. Questions: `deployment` (`local`/`langgraph-cloud`/`self-hosted`),
`checkpointing` (`memory`/`supabase`/`redis`/`postgres`), `streaming` (bool), `graph_type`
(`simple-chain`/`research-agent`), `human_in_loop` (bool). Env: `LANGGRAPH_DEPLOYMENT`,
`LANGGRAPH_API_URL`, `LANGGRAPH_API_KEY`, `LANGGRAPH_CHECKPOINTER`, `LANGGRAPH_HITL_ENABLED`.

## Usage

```bash
# end-to-end out of the box:
curl -X POST localhost:3000/api/agent/invoke -d '{"prompt":"Hello"}'
```

Customise the graph in `src/infrastructure/langgraph/graphs/<graph_type>.graph.ts`; nodes live in
`nodes/`.

## Notes for agents

- `yarn add @langchain/langgraph @langchain/core`.
- Swap `LANGGRAPH_CHECKPOINTER` to persist across requests — each option auto-emits its checkpointer file.
- Streaming → `POST /api/agent/stream` (SSE). HITL → wire `human-review` with
  `interruptBefore: ["human-review"]`, resume via `POST /api/agent/resume`.

## Checklist (post-install)

Install LangGraph; merge env; POST `/api/agent/invoke`; pick a persistent checkpointer; customise
the graph; enable streaming/HITL if chosen.

## Related

Requires [`env-setup`](../env-setup), [`llm-adapter`](../llm-adapter). Persistence options pair with
[`supabase`](../supabase) / [`bullmq`](../bullmq) (Redis).
