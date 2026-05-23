# Gate 3B: Prompt-Compiler ACL Resolution for Tandem Stage 1

## Status

Accepted

## Context

Phase 3B (Stage 1 dispatch) requires injecting a custom system prompt template for each tandem turn, overriding the session's default system prompt for Stage 1 only. The `local-llm` bounded context enforces an ACL: all LLM inputs must come through `SendStructuredRequestPort` via `LLMRequest`.

The planning document (Section 13, Gate 3B) required a decision between:

- **Option A (Preferred):** Extend `prompt-compiler` with a `TandemStage1PromptRequest` variant.
- **Option B (Documented exception):** Route Stage 1 dispatch directly to the WebLLM runtime, bypassing `prompt-compiler`.

## Decision

**Option A — Use existing `SendStructuredRequestPort` with system message injection.**

After reviewing `LLMRequest` (`packages/local-llm/src/domain/value-objects/llm-request.vo.ts`), the `messages` field already accepts `{ role: "system" | "user" | "assistant"; content: string }[]`. The tandem Stage 1 system prompt template (Section 6.1) is injected as the first element of `messages` with `role: "system"` when constructing the `LLMRequest`.

This satisfies the ACL requirement without extending `prompt-compiler`:

- All Stage 1 dispatch routes through `SendStructuredRequestPort.streamStructuredRequest`.
- The `FreeFormStringSchema` (already exported from `@hexagen/local-llm`) is used as the schema, consistent with chat/free-form use cases.
- The tandem system prompt is scoped to the `LLMRequest` for that turn only — it does not mutate any session state or persist beyond the request.

No new `prompt-compiler` port variant is required. No ACL exception is needed.

## Rationale

- `LLMRequest.messages` was designed to accept system-role messages. Using it for tandem Stage 1 is the intended usage pattern.
- `FreeFormStringSchema` was explicitly provided for chat/free-form use cases (ADR-0021, Stage 3 ACL Cutover).
- Extending `prompt-compiler` would add indirection without benefit — the tandem system prompt is a pipeline-internal concern, not a user-facing instruction requiring RRP compilation or Zod schema generation.
- This decision is consistent with how `apps/web` hooks use `LLMRequest["messages"]` for governance assistant calls (ADR-0021 implementation notes).

## Consequences

- Stage 1 dispatch constructs an `LLMRequest` with the tandem system prompt as `messages[0]` (role: "system") and the user prompt as `messages[1]` (role: "user").
- `FreeFormStringSchema` is used as the schema.
- The system prompt is not persisted to session state and does not affect subsequent calls.
- No `prompt-compiler` changes required.
- No ACL violation — `SendStructuredRequestPort` is the ACL gate and is used correctly.

## Date

2026-05-22
