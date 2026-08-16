# Template: LLM Adapter

**Branch:** `feature/generator-template-llm-adapter`

## Purpose

Generates a clean hexagonal LLM integration: a typed port interface, provider-specific adapter(s), model name constants, reasoning vs non-reasoning routing, retry logic, timeout handling, and structured JSON output support. Designed so swapping providers or adding new ones is a single file change.

---

## Install-Time Questions

| ID                   | Prompt                                              | Type        | Options                                                | Default        |
| -------------------- | --------------------------------------------------- | ----------- | ------------------------------------------------------ | -------------- |
| `providers`          | Which LLM providers?                                | multiselect | `xai`, `openai`, `anthropic`, `ollama`, `azure-openai` | `xai`          |
| `primary_provider`   | Primary provider for orchestration (reasoning)?     | select      | (from providers)                                       | first selected |
| `reasoning_routing`  | Route orchestration calls to a reasoning model?     | boolean     | —                                                      | `true`         |
| `structured_output`  | Need structured JSON output with schema validation? | boolean     | —                                                      | `true`         |
| `streaming`          | Enable streaming responses?                         | boolean     | —                                                      | `false`        |
| `default_timeout_ms` | Default request timeout (ms)?                       | select      | `15000`, `30000`, `60000`, `120000`                    | `30000`        |
| `max_retries`        | Max retries on transient failure?                   | select      | `0`, `1`, `2`, `3`                                     | `2`            |

---

## Files Generated

```
src/
  domain/
    ports/
      out/
        llm-client.port.ts         # LLMClientPort interface
  infrastructure/
    llm/
      constants/
        models.ts                  # Model name constants per provider
        capabilities.ts            # Reasoning vs non-reasoning classification
      adapters/
        xai-llm-client.adapter.ts  # xAI / Grok adapter
        openai-llm-client.adapter.ts
        anthropic-llm-client.adapter.ts
        ollama-llm-client.adapter.ts
      router/
        llm-router.ts              # Selects adapter + model based on call type
      utils/
        retry.ts                   # Exponential backoff with jitter
        timeout.ts                 # Promise.race-based timeout wrapper
        structured-output.ts       # JSON parse + Zod schema validation
      errors/
        llm-errors.ts              # LLMTimeoutError, LLMParsingError, etc.
      index.ts                     # Barrel: exports router + port

.env.llm.example
```

---

## Generated .env Variables

```env
# LLM — xAI
XAI_API_KEY=
XAI_BASE_URL=https://api.x.ai/v1

# LLM — OpenAI (if selected)
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1

# LLM — Anthropic (if selected)
ANTHROPIC_API_KEY=

# LLM — Ollama (if selected)
OLLAMA_BASE_URL=http://localhost:11434

# LLM Routing
LLM_REASONING_MODEL=grok-3-mini       # Used for orchestration / complex reasoning
LLM_FAST_MODEL=grok-3-fast            # Used for wizard / simple completions
LLM_DEFAULT_TIMEOUT_MS=30000
LLM_MAX_RETRIES=2
```

---

## Key Design Decisions

**Port interface is minimal:** `call(prompt, options)` → `LLMResponse`. Structured output, streaming, and retry are handled in the infrastructure layer, not exposed on the port. This keeps application-layer code clean.

**Model constants are env-overridable:** `models.ts` exports `REASONING_MODEL = process.env.LLM_REASONING_MODEL ?? 'grok-3-mini'`. Updating to a new model is a one-line env var change, not a code change.

**Reasoning routing is semantic, not model-based:** The router receives a `CallType` (`orchestration | wizard | fast`). The mapping of call type → model name lives entirely in `llm-router.ts`. Swapping which model handles orchestration doesn't touch adapters.

**Structured output uses Zod:** Adapter parses the raw LLM string, catches JSON.parse errors, and validates against the caller-supplied Zod schema. Returns `Result<T, LLMParsingError>` so callers handle failures explicitly.

---

## Phase 1 — Port Interface & Types

**Goal:** Define the contract all adapters must satisfy.

```typescript
// llm-client.port.ts
export interface LLMClientPort {
  call(
    prompt: string,
    options?: LLMCallOptions,
  ): Promise<Result<LLMResponse, LLMError>>;
  callStructured<T>(
    prompt: string,
    schema: ZodSchema<T>,
    options?: LLMCallOptions,
  ): Promise<Result<T, LLMError>>;
}

export interface LLMCallOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  systemPrompt?: string;
}

export type LLMResponse = { content: string; model: string; usage: TokenUsage };
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};
```

Validation: TypeScript compiles; no concrete implementation yet.

---

## Phase 2 — Model Constants

**Goal:** Single source of truth for model names, with env override and reasoning classification.

```typescript
// constants/models.ts
export const MODELS = {
  xai: {
    reasoning: process.env.LLM_REASONING_MODEL ?? "grok-3-mini",
    fast: process.env.LLM_FAST_MODEL ?? "grok-3-fast",
    vision: process.env.LLM_VISION_MODEL ?? "grok-2-vision",
  },
  openai: {
    reasoning: process.env.OPENAI_REASONING_MODEL ?? "o3-mini",
    fast: process.env.OPENAI_FAST_MODEL ?? "gpt-4o-mini",
  },
  anthropic: {
    reasoning: process.env.ANTHROPIC_REASONING_MODEL ?? "claude-opus-4-7",
    fast: process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-4-5",
  },
} as const;
```

```typescript
// constants/capabilities.ts
export const REASONING_CAPABLE_MODELS = new Set([
  "grok-3-mini",
  "o3-mini",
  "o1-preview",
  "claude-opus-4-7",
]);

export function isReasoningModel(modelId: string): boolean {
  return REASONING_CAPABLE_MODELS.has(modelId);
}
```

Validation: Unit test asserting `isReasoningModel('grok-3-mini') === true`.

---

## Phase 3 — xAI Adapter

**Goal:** Fully working adapter for the primary provider.

Uses the OpenAI-compatible REST API (POST `/v1/chat/completions`). Handles:

- Auth header injection
- Request serialization
- Response deserialization
- HTTP error classification (`401 → LLMAuthError`, `429 → LLMRateLimitError`, `5xx → LLMServiceError`)

Validation: Integration test with real `XAI_API_KEY` (skipped in CI without key); mock test for error classification.

---

## Phase 4 — Retry & Timeout Utilities

**Goal:** Shared infrastructure for resilience, used by all adapters.

`retry.ts`:

- Exponential backoff: `base * 2^attempt + jitter(0..base)`
- Only retries on `LLMServiceError` and `LLMRateLimitError` (not auth or parsing errors)
- Respects `Retry-After` header when present on 429

`timeout.ts`:

- `withTimeout(promise, ms)` → rejects with `LLMTimeoutError` after `ms`
- Cleans up the inner promise (no dangling await)

Validation: Unit test for backoff timing; unit test for timeout rejection.

---

## Phase 5 — LLM Router

**Goal:** Single entry point that selects the right adapter and model for a given call type.

```typescript
// router/llm-router.ts
export type CallType = "orchestration" | "wizard" | "fast" | "vision";

export class LLMRouter implements LLMClientPort {
  call(prompt: string, options?: LLMCallOptions & { callType?: CallType }) {
    const resolved = this.resolve(options?.callType ?? "fast");
    return resolved.adapter.call(prompt, { ...options, model: resolved.model });
  }
}
```

Routing table (configurable):

```
orchestration → primary provider, reasoning model
wizard        → primary provider, fast model
fast          → primary provider, fast model
vision        → primary provider, vision model (if supported)
```

Validation: Unit test with mock adapters; assert orchestration calls route to reasoning model.

---

## Phase 6 — Structured Output

**Goal:** Type-safe structured JSON output with schema validation and repair.

```typescript
// utils/structured-output.ts
export async function callStructured<T>(
  client: LLMClientPort,
  prompt: string,
  schema: ZodSchema<T>,
  options?: LLMCallOptions,
): Promise<Result<T, LLMParsingError>>;
```

Strategy:

1. Append JSON schema instructions to system prompt
2. Call `client.call()`
3. Extract JSON from response (handles code-fenced and raw JSON)
4. `JSON.parse()` → `schema.safeParse()`
5. On validation failure: attempt one repair call with the validation error context
6. Return `Result<T, LLMParsingError>` with full error context on failure

Validation: Unit test with schema, valid response, invalid response (triggers repair), and unparseable response.

---

## Phase 7 — Additional Provider Adapters

One adapter per selected provider, following the xAI adapter's structure exactly. Includes:

- `openai-llm-client.adapter.ts` (native SDK or fetch)
- `anthropic-llm-client.adapter.ts`
- `ollama-llm-client.adapter.ts` (local, no API key)

Validation: Smoke test for each adapter (real key in CI secrets or skip guard).

---

## Post-Install Checklist

```
✅ llm-adapter installed

Next steps:
  1. Add XAI_API_KEY (and other provider keys) to .env.local
  2. Verify LLM_REASONING_MODEL matches a model on your current tier
  3. Run: yarn vitest run src/infrastructure/llm/__tests__/router.test.ts
  4. Check xAI console for RPM and TPM limits — set TEXT_RPM accordingly
  5. See SETUP.md → LLM Adapter for model name reference and tier limits
```

---

## Template Dependencies

- Required: `env-setup` (for API key validation at startup)
- Soft dependency: `rate-limiting` (for upstream 429 → retry coordination)
- Soft dependency: `observability` (structured logging of LLM call latency)
