# ADR-0016: Local LLM Streaming Fixes — Model Selection, Sampling Pipeline, and React StrictMode Token Doubling

**Date:** 2026-04-17
**Status:** Accepted — partially superseded by ADR-0017 (2026-08-23): model-ID strategy and metadata approach
**Authors:** Human Architect
**Supersedes:** None

---

## Context

The in-browser local LLM integration (`@hexagen/local-llm` + `apps/web`) exhibited
three compounding problems that together produced broken output in the governance
assistant panel:

1. **Token doubling** — every token streamed from the model appeared twice, producing
   garbled output such as `"The The architecture architecture is is clean clean"`.
2. **Invalid model ID** — `Gemma-2B-it-q4f32f16-MLC` was not a real MLC model
   identifier (wrong casing, wrong quantization suffix, wrong variant flag).
3. **Missing sampling parameters** — `repetitionPenalty` was defined in
   `DEFAULT_TUNING_CONFIG` but silently dropped before reaching the WebLLM engine,
   so the engine always ran with its default value of `1.0` (disabled).

Debugging was complicated because the three issues interacted: the model ID failure
prevented loading, the invalid model swap introduced its own stutter artefacts, and
the token-doubling symptom appeared identical whether caused by the streaming
adapter, the Worker, or React state management.

---

## Investigation Log

A summary of each hypothesis tested, in order, to serve as a guide if similar
symptoms recur.

### Hypothesis 1 — Streaming adapter race (rejected as root cause)

The original `streamComplete` in `webllm.adapter.ts` used a dual-path design:
a `resolveNext` callback for the case where the consumer was waiting, and a
`pendingChunks` array for the case where chunks arrived before the consumer
was ready. A theoretical race existed: a `message` event arriving between the
`if (resolveNext)` null-check and the `else { pendingChunks.push(...) }` branch
could be handled by both paths on a microtask boundary, yielding the same chunk
twice.

**Result:** JavaScript's single-threaded event loop makes this race practically
impossible. Rewriting the adapter with a FIFO queue eliminated the structural
ambiguity but did not cure the symptom.

### Hypothesis 2 — WebLLM `delta.content` is cumulative (rejected)

Suspicion that `chunk.choices[0]?.delta?.content` returned the full accumulated
text rather than only the new token, requiring a diff before yielding.

**Result:** Confirmed via WebLLM source (`@mlc-ai/web-llm` v0.2.82) that
`delta.content` is incremental. The Worker and adapter were correct.

### Hypothesis 3 — isStreaming state guard insufficient (partially correct)

`isStreaming` React state was checked at the top of `sendMessage` to prevent
concurrent calls. In React 18 Strict Mode, `useEffect` cleanup + re-mount
can cause two rapid calls before `setIsStreaming(true)` resolves (state updates
are asynchronous and batched).

**Result:** A `useRef` guard (`isStreamingRef`) set synchronously at the start
of each send function correctly prevents concurrent streaming calls. This is a
legitimate fix, but it addresses a different symptom (duplicate send calls) rather
than the per-token doubling.

### Hypothesis 4 — React StrictMode double-invokes state updater functions (root cause, confirmed)

React 18 Strict Mode deliberately invokes state updater functions **twice** in
development to detect side effects in impure updaters. The original `setMessages`
updater was:

```typescript
setMessages((prev) => {
  const updated = [...prev]; // shallow copy of array
  const last = updated[updated.length - 1]; // reference to same object
  if (last?.id === assistantMsgId) {
    last.content += result.value; // MUTATION of shared object reference
  }
  return updated;
});
```

On the first invocation React discards the result but the mutation of `last.content`
has already occurred. On the second invocation, `last.content` already contains the
appended token, so it is appended again. The returned array is used as the final
state, giving every token exactly twice.

**Fix:** Return a new object instead of mutating the existing one:

```typescript
setMessages((prev) => {
  const last = prev[prev.length - 1];
  if (!last || last.id !== assistantMsgId) return prev;
  return [
    ...prev.slice(0, -1),
    { ...last, content: last.content + result.value },
  ];
});
```

This pattern is idempotent — calling it twice with the same `result.value`
produces the same result — so Strict Mode double-invocation is harmless.

---

## Model Selection Journey

### Phi-3-mini (baseline, replaced)

`Phi-3-mini-4k-instruct-q4f16_1-MLC` was the original model. Replaced in the
first phase of this work due to poor instruction-following quality for
architectural guidance tasks.

### Gemma 2B-it (attempted, rejected)

`Gemma-2B-it-q4f32f16-MLC` was the first replacement candidate. Two issues:

- **Invalid model ID.** The correct MLC identifier is
  `gemma-2-2b-it-q4f16_1-MLC`. The original ID had wrong casing (`Gemma` vs
  `gemma`), wrong quantization (`q4f32f16` does not exist in the MLC catalogue),
  and a missing version segment (`-2-`).
- **Intrinsic token stutter.** Even with the correct ID, Gemma 2B-it exhibits a
  token-level duplication pattern in WebLLM that cannot be suppressed through
  sampling parameters alone (tested: `repetitionPenalty` up to `1.4`,
  `frequencyPenalty` up to `0.5`, removing `topP` constraints). This is a known
  characteristic of the 2B quantization for this model family.

### Qwen2.5-3B-Instruct (accepted)

`Qwen2.5-3B-Instruct-q4f16_1-MLC` was selected as the replacement:

- No intrinsic token stutter at any tested sampling configuration.
- 3B parameter count with 32K context window (vs 4K for Phi-3-mini).
- 151,936-token vocabulary; strong multilingual and code coverage.
- Vendor: Alibaba Cloud (Tongyi Qianwen series).

Model metadata in `model-metadata.vo.ts` was updated accordingly:
`contextLength: 32768`, `vendor: "Alibaba"`, `parameterCount: "3B"`,
`vocabularySize: 151936`.

---

## Decision

### 1. Root cause fix — immutable setMessages updater

All `setMessages` calls that append streaming tokens must return a **new object**
for the mutated message. Mutating the existing object reference is forbidden in
any state updater function regardless of Strict Mode setting, as React reserves
the right to invoke updaters multiple times.

This applies to both `sendMessage` and `sendGovernanceMessage` in
`use-local-llm.tsx`.

### 2. Synchronous streaming guard — `isStreamingRef`

A `useRef<boolean>` (`isStreamingRef`) is set to `true` at the synchronous
top of each send function and cleared in `finally`. This prevents concurrent
streaming calls that could arise from:

- Rapid double-submit before `setIsStreaming(true)` resolves.
- Any future `useEffect`-driven call that fires before state update batching
  completes.

`isStreaming` state is kept for UI purposes (disabling the submit button).
`isStreamingRef` is the authoritative guard for control flow.

### 3. Streaming adapter — FIFO queue pattern

`streamComplete` in `webllm.adapter.ts` uses a typed FIFO queue:

```typescript
type QueueItem =
  | { kind: "chunk"; value: string }
  | { kind: "done" }
  | { kind: "error"; error: Error };
```

The Worker message handler (producer) calls `enqueue(item)`. The async generator
loop (consumer) drains the queue and awaits a `notify` callback when the queue
is empty. This eliminates the dual-path `resolveNext` / `pendingChunks` design
and makes producer/consumer responsibilities unambiguous.

### 4. Sampling parameter pipeline

All sampling parameters are threaded end-to-end:

```
DEFAULT_TUNING_CONFIG (domain VO)
  → LLMCompletionRequest (port)
    → use-local-llm.tsx (sendMessage / sendGovernanceMessage)
      → WebLLMAdapter.streamComplete (adapter)
        → webllm.worker.ts (Worker postMessage)
          → engine.chat.completions.create() (WebLLM engine)
```

Parameters in scope: `temperature`, `topP`, `topK`, `frequencyPenalty`,
`presencePenalty`, `repetitionPenalty`, `maxTokens`.

`DEFAULT_TUNING_CONFIG` (in `model-metadata.vo.ts`):

| Parameter           | Value | Rationale                                         |
| ------------------- | ----- | ------------------------------------------------- |
| `temperature`       | 0.6   | Focused but not deterministic                     |
| `topP`              | 0.9   | Standard nucleus sampling for instruction models  |
| `frequencyPenalty`  | 0.0   | Qwen2.5 does not require frequency damping        |
| `repetitionPenalty` | 1.05  | Mild suppression; Qwen2.5 does not stutter at 1.0 |

### 5. Model: Qwen2.5-3B-Instruct

`DEFAULT_MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC"` is the accepted default.
Context length fallbacks across the codebase (`prunedHistoryWindow`, token
budget guards) are updated from `4096` → `32768` to match.

---

## Manifest changes

No new ports, use cases, or bounded contexts were added. All changes are
within existing elements of the `local-llm` and `web-driver` bounded contexts.

**`local-llm` bounded context — `model-metadata.vo.ts`:**

- `DEFAULT_MODEL_ID` updated to `Qwen2.5-3B-Instruct-q4f16_1-MLC`
- `DEFAULT_TUNING_CONFIG` added with the five sampling parameters above
- `getLoadedModel()` metadata updated for Qwen2.5-3B

**`local-llm` bounded context — `local-llm-provider.port.ts`:**

- `LLMCompletionRequest` extended with `topP`, `topK`, `frequencyPenalty`,
  `presencePenalty`, `repetitionPenalty`

**`web-driver` bounded context — `use-local-llm.tsx`:**

- Immutable `setMessages` updater (root cause fix)
- `isStreamingRef` synchronous guard
- All sampling params wired from `DEFAULT_TUNING_CONFIG`

**`web-driver` bounded context — `webllm.adapter.ts`:**

- `streamComplete` rewritten with FIFO queue

**`web-driver` bounded context — `webllm.worker.ts`:**

- All sampling params forwarded to `engine.chat.completions.create()`

---

## Consequences

### Positive

- Token doubling is fully resolved; confirmed clean across multiple test prompts.
- Sampling parameters are now correctly wired end-to-end; tuning changes in
  `DEFAULT_TUNING_CONFIG` propagate without code changes in the hook or Worker.
- Streaming adapter is structurally correct and does not rely on shared mutable
  state between producer and consumer.
- `isStreamingRef` prevents double-send in both StrictMode and rapid-user-input
  scenarios.
- Model upgrade from 2B (Gemma) to 3B (Qwen2.5) with 8× larger context window.

### Negative

- Qwen2.5-3B-Instruct is a larger download than Gemma 2B; first-load time
  increases on slow connections.
- `repetitionPenalty` and `frequencyPenalty` semantics differ between model
  families; `DEFAULT_TUNING_CONFIG` may need re-tuning if the model is swapped.

### Neutral

- Strict Mode is retained (`reactStrictMode: true` in `next.config.mjs`). The
  root cause fix makes the streaming code Strict Mode-safe by design, so
  disabling Strict Mode is not a mitigation and was not considered.

---

## Learnings

1. **React Strict Mode double-invokes state updater functions.** Any updater
   passed to `setState` must be a pure function. Mutating a value obtained from
   `prev` before returning the new array violates this contract and produces
   doubled side effects in development. This is not a React bug — it is
   intentional API behaviour documented in the React 18 upgrade guide.

2. **MLC model IDs are exact strings.** The catalogue at
   `https://mlc.ai/models` uses a specific naming scheme:
   `{family}-{size}-{variant}-{quantization}-MLC`. Any deviation (casing,
   missing segment, wrong quant code) results in a silent load failure or
   download of the wrong weights.

3. **Token stutter is model-specific, not parameter-tunable for some models.**
   Gemma 2B-it exhibited intrinsic token duplication in WebLLM at this
   quantization level. Increasing `repetitionPenalty` reduced but did not
   eliminate it. When a model shows this behaviour, swapping the model is more
   reliable than parameter search.

4. **`useRef` and `useState` serve different roles for guards.** State is
   correct for UI-reactive concerns (button disabled state). A ref is required
   for any guard that must take effect before the next render cycle, such as
   preventing a second in-flight async call.

5. **Debugging streaming bugs requires isolating layers.** The symptom (doubled
   tokens) was identical whether the cause was in the adapter, the Worker, or the
   React hook. Confirming `delta.content` is incremental (not cumulative) via
   source inspection, then confirming the Worker forwarded it correctly, then
   confirming the adapter yielded it once, narrowed the problem to the React layer
   in a reproducible order.

---

## Verification

1. Multiple streaming responses produce no doubled tokens in development
   (Strict Mode enabled) and production builds.
2. `repetitionPenalty` is present in the `generate` Worker message payload when
   inspected via browser DevTools Worker message log.
3. Rapid double-submit (keyboard + mouse simultaneously) triggers `isStreamingRef`
   guard and the second call is dropped without corrupting state.
4. `yarn build && yarn typecheck && yarn lint` pass (verified at commit time by
   pre-commit hook running all 26 test suites).
5. `yarn lint:arch` reports no violations.

---

## Related

- `packages/local-llm/src/domain/value-objects/model-metadata.vo.ts`
- `packages/local-llm/src/domain/ports/local-llm-provider.port.ts`
- `packages/local-llm/src/infrastructure/adapters/webllm.adapter.ts`
- `apps/web/app/workers/webllm.worker.ts`
- `apps/web/app/hooks/use-local-llm.tsx`
- `apps/web/app/lib/grounded-prompt.ts`
- Commits `1f3a497`, `f51d9ed` (squashed from 5 incremental fix commits)
- ADR-0012: Human-Guided Modification Loop
