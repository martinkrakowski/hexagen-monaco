# LLM Adapter (`llm-adapter`)

> A typed `LLMClientPort` with provider adapters (xAI, OpenAI, Anthropic, Ollama, Azure OpenAI),
> model constants, reasoning routing, retry logic, and structured (Zod) output.

|               |                                          |
| ------------- | ---------------------------------------- |
| **ID**        | `llm-adapter`                            |
| **Category**  | Core infrastructure (LLM)                |
| **Requires**  | `env-setup`, `error-handling`            |
| **Conflicts** | none                                     |
| **Branch**    | `feature/generator-template-llm-adapter` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

A provider-agnostic LLM seam: one port, swappable provider adapters, a router that picks
reasoning/fast/vision models per call, retry + timeout, and optional Zod-validated structured
output. The application layer depends only on the port.

## What it scaffolds

- `src/domain/ports/out/llm-client.port.ts` — the port.
- `src/infrastructure/llm/adapters/*` — one adapter per provider.
- `router/{llm-router,provider-registry}.ts`, `constants/{models,capabilities}.ts`,
  `utils/{retry,timeout,structured-output,parse-env}.ts`, `smoke-test.ts`, `.env.llm.example`.

## Install

`hexagen add llm-adapter`. Questions: `providers` (multiselect), `primary_provider`,
`reasoning_routing` (bool), `structured_output` (bool), `streaming` (bool), `default_timeout_ms`,
`max_retries`. Env: per-provider keys + `LLM_REASONING_MODEL` / `LLM_FAST_MODEL` /
`LLM_VISION_MODEL` / `LLM_DEFAULT_TIMEOUT_MS` / `LLM_MAX_RETRIES`.

## Usage

```ts
import { LLMRouter } from "@/infrastructure/llm/router/llm-router";

const llm = new LLMRouter("xai"); // primary provider
const res = await llm.complete({ prompt: "…", capability: "reasoning" });
```

```bash
npx tsx src/infrastructure/llm/smoke-test.ts   # verify provider wiring
```

## Notes for agents

- Returns `Result<…>` (from [`error-handling`](../error-handling)); add API keys for selected providers.
- `primary_provider` must be in the `providers` list; `LLM_REASONING_MODEL` must exist on your tier.
- Extensible via the **provider-registration seam** — see [`llm-adapter-bedrock`](../llm-adapter-bedrock).

## Checklist (post-install)

Merge `.env.llm.example`; add API keys; confirm primary provider; verify model availability; run
the smoke test.

## Related

Requires [`env-setup`](../env-setup), [`error-handling`](../error-handling). Extensions:
[`llm-adapter-bedrock`](../llm-adapter-bedrock), [`langgraph`](../langgraph).
