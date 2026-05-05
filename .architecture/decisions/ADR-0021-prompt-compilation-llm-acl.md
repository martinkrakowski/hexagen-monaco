# ADR 0021: Prompt Compilation & LLM ACL Enforcement

## Status

Accepted

## Context

The probabilistic layer (Phase 5) must enforce a strict Anti-Corruption Layer (ACL) between the deterministic kernel and LLM inference. Currently:

1. **`prompt-compiler`** has a minimal skeleton — `PromptCompilerPort` and `DefaultPromptCompilerAdapter` with hardcoded templates. It lacks:
   - RRP-driven system instruction generation
   - Zod-backed structured output schema generation (critical for ACL)
   - Prompt cache with semantically-derived keys
   - Migration of rich app-level prompt logic (`grounded-prompt.ts`, `governance-question-templates.ts`, `wizard-assistant-context.ts`)

2. **`local-llm`** accepts raw `LLMMessage[]` with no schema validation at the response boundary. There is no enforcement that LLM inputs come through the prompt-compiler, meaning UI code could bypass the compilation pipeline entirely.

3. **`reconciliation-engine`** has a single `ReconciliationPort` with a naive line-parsing adapter. It lacks:
   - Discriminated-union verdict types (heuristic vs deterministic)
   - Monotonic state promotion (pending → confirmed → reconciled → rejected)
   - Conflict resolution with the invariant: **LLM NEVER overrides the deterministic kernel**
   - Separate ports for comparison, promotion, and conflict resolution

The system must guarantee that no LLM output bypasses deterministic kernel authority, and that all LLM inputs are schema-validated.

## Decision

### 5.A — Prompt Compiler Completion

Introduce three new domain value objects:

1. **`SystemInstruction`**: Encapsulates a compiled system prompt with metadata (RRP version, governance context hash). Immutable after creation.
2. **`StructuredOutputSchema`**: Wraps a Zod schema with a stable hash for cache keying. The hash is derived from the Zod AST, not the runtime object, ensuring deterministic caching.
3. **`PromptCacheKey`**: Branded string derived from `hash(normalized RRP + system instruction version)`. Explicitly excludes transient/spatial data (editor cursor position, scroll offset, viewport size).

Add three new inbound ports:

1. **`BuildSystemInstructionPort`**: `(rrp: RRP, governance: GovernancePayload) → Result<SystemInstruction>`
2. **`GenerateZodSchemaPort`**: `(rrp: RRP) → Result<StructuredOutputSchema>`
3. **`CachePromptPort`**: `(key: PromptCacheKey, template: PromptTemplate) → Result<void>` + get/has/delete

Add three new use cases:

1. **`CompilePromptUseCase`**: Orchestrates BuildSystemInstructionPort + GenerateZodSchemaPort → produces a fully-compiled PromptTemplate with schema attached
2. **`RenderPromptUseCase`**: Renders a compiled template with variable substitution (existing `renderPrompt` logic)
3. **`CachePromptUseCase`**: Wraps CachePromptPort for CRUD operations

Migrate app-level code:

- `apps/web/app/lib/grounded-prompt.ts` → `packages/prompt-compiler/src/infrastructure/adapters/grounded-prompt-builder.adapter.ts` (implements BuildSystemInstructionPort)
- `apps/web/app/lib/governance-question-templates.ts` → `packages/prompt-compiler/src/domain/governance-question-templates.ts` (domain-level templates)
- `apps/web/app/lib/wizard-assistant-context.ts` → `packages/prompt-compiler/src/infrastructure/adapters/wizard-context-serializer.adapter.ts`

### 5.B — LLM ACL Enforcement

Add to `local-llm`:

1. **`SendStructuredRequestPort`**: New inbound port — accepts ONLY `(prompt: PromptTemplate, schema: StructuredOutputSchema)`. Never raw UI events or uncompiled messages. This is the ACL gate.
2. **`LLMRequest`** value object: Wraps a compiled prompt + schema — the only legal input to LLM inference.
3. **`LLMResponse`** value object: Already exists but needs schema-validation integration.
4. **`SchemaValidationResult`** value object: `{ valid: boolean; errors: ZodIssue[]; response: LLMResponse }`

Refactor existing adapters:

- `WebLLMAdapter` — implement `SendStructuredRequestPort`; add Zod schema validation at response boundary; hard-failure on schema drift
- Cloud adapter (future) — same pattern

Migrate app-level config:

- `apps/web/app/config/models.ts` → `packages/local-llm/src/domain/model-catalog.ts`
- `apps/web/app/config/cloud-providers.ts` → `packages/local-llm/src/domain/cloud-provider-catalog.ts`
- `apps/web/app/lib/model-recommendation.ts` → `packages/local-llm/src/application/use-cases/recommend-model.use-case.ts`
- `apps/web/app/workers/webllm.worker.ts` stays at app-level (Next.js bundling constraint) but imports core logic from `@hexagen/local-llm`

### 5.C — Reconciliation Engine Completion

Add domain value objects:

1. **`Verdict`**: Discriminated union — `{ source: "deterministic" | "heuristic", result: DomainAST | Patch[], confidence: 1.0 | 0..1 }`
2. **`ReconciliationState`**: Discriminated union — `pending | confirmed | reconciled | rejected` with monotonic transition enforcement

Add ports + use cases:

1. **`CompareVerdictsPort`** + `CompareVerdictsUseCase`: Compare deterministic vs heuristic verdicts
2. **`PromoteStatePort`** + `PromoteStateUseCase`: Enforce monotonic state transitions (pending → confirmed → reconciled, never backwards)
3. **`ResolveConflictPort`** + `ResolveConflictUseCase`: When verdicts disagree, deterministic kernel ALWAYS wins. LLM output is annotated but never authoritative.

Add adapters:

1. **`DefaultVerdictComparatorAdapter`**: Structured comparison with confidence scoring
2. **`MonotonicStatePromoterAdapter`**: Enforces state transition legality; rejects invalid transitions
3. **`DefaultConflictResolverAdapter`**: Deterministic-first conflict resolution. LLM NEVER overrides.

## Consequences

### Positive

- LLM inputs are guaranteed to pass through prompt-compiler's schema generation (ACL enforcement)
- LLM outputs are validated against Zod schemas at 100% rate at the response boundary
- Reconciliation state transitions are provably monotonic
- Deterministic kernel authority is never compromised by LLM output
- Prompt caching uses semantically-derived keys, excluding transient data
- App-level prompt logic migrates to proper hexagonal packages

### Negative

- Increased indirection — LLM requests must flow through prompt-compiler before reaching local-llm
- Zod schema validation adds latency at response boundary (acceptable for governance use case)
- Breaking change for any code that directly constructs `LLMMessage[]` — must migrate to `SendStructuredRequestPort`

## Implementation Status

### Stage 3 — ACL Cutover (Completed 2026-04-22)

The ACL has been implemented as follows:

**Port split (S3.Q4):**

- `LocalLLMProviderPort` (legacy monolith, `@internal`) → `ModelLifecyclePort` + `SendStructuredRequestPort`
- `ModelLifecyclePort`: `initialize`, `getLoadedModel`, `hasModelInCache`, `deleteCachedModel`, `dispose`
- `SendStructuredRequestPort`: `sendRequest` + `streamStructuredRequest` (S3.Q1)

**ACL gate:**

- `LLMMessage` and `LLMCompletionRequest` marked `@internal` — not for external consumption
- All `apps/web` call sites migrated to `SendStructuredRequestPort` via `LLMRequest` + schema
- `FreeFormStringSchema` (S3.Q2) provided for chat/free-form use cases
- Governance uses strict Zod schemas via `LLMRequest.schema`

**Enforcement layers:**

- Layer 2: ESLint `no-restricted-imports` blocks runtime `LLMMessage`/`LocalLLMProviderPort` imports from `@hexagen/local-llm`; `import type` allowed (S3.Q3)
- Layer 3: `scripts/validate-ui-boundary.sh` extended to check `apps/web` for runtime ACL violations

**Deferred:**

- Cloud chat route ACL (`/api/llm/chat/route.ts`) deferred to Stage 3.5 (S3.Q5)

**Key files changed:**

- `packages/local-llm/src/application/ports/in/send-structured-request.port.ts` — extended with `streamStructuredRequest` + `FreeFormStringSchema`
- `packages/local-llm/src/domain/ports/model-lifecycle.port.ts` — new file
- `packages/local-llm/src/infrastructure/adapters/webllm.adapter.ts` — implements both new ports
- `apps/web/app/lib/wire.ts` — registers both new ports
- `apps/web/app/hooks/local-llm/*.ts` — migrated to new ports
- `apps/web/features/governance-assistant/hooks/**/*.ts` — migrated to `LLMRequest["messages"]`

## Implementation Plan

See `.architecture/plans/phase-3-7-execution-plan-v1.md` Phase 5 atomic units.

## Related

- ADR 0019: Execution DAG Architecture
- ADR 0020: Transaction Lifecycle & Speculative State Semantics
