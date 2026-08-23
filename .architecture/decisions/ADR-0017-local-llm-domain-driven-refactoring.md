# ADR-0017: Local LLM Domain-Driven Refactoring — DomainModelId, Result<T>, and Event Leak Guards

**Date:** 2026-04-17
**Status:** Accepted — partially supersedes ADR-0016
**Authors:** Human Architect
**Supersedes:** Partially supersedes ADR-0016 (model ID strategy; metadata approach)

---

## Context

ADR-0016 resolved streaming and model-selection bugs by hardcoding `Qwen2.5-3B-Instruct-q4f16_1-MLC` as `DEFAULT_MODEL_ID` and inlining model metadata in the adapter. This was expedient but introduced three architectural problems:

1. **Infrastructure IDs leaked into domain logic.** MLC engine IDs (e.g., `"Qwen2.5-3B-Instruct-q4f16_1-MLC"`) appeared in the port interface, use cases, hook, and React components. Adding a cloud provider or swapping the engine would require touching every layer.

2. **Hardcoded model metadata.** `getLoadedModel()` in the adapter returned static values (`vendor: "Alibaba"`, `parameterSize: "3B"`, `contextLength: 32768`) regardless of which model was actually loaded. Switching models showed the wrong metadata because there was no per-model metadata map.

3. **React SyntheticEvent forwarding.** Passing `initializeModel` directly as an `onClick` handler caused React to forward the click event as the first argument, producing "Unknown model ID: [object Object]" at runtime. This is a general hazard whenever a function accepting an optional `DomainModelId` is passed as an event handler.

Additionally, two existing patterns were inconsistent:

- Cache operations (`hasModelInCache`, `deleteCachedModel`) returned bare `Promise<boolean>` / `Promise<void>` while the port's `initialize()` already returned `Promise<Result<void>>`. Error paths were silently swallowed.
- The retry button in the error state called `clearError()` (which only clears `errorMessage` state) instead of `initializeModel()`, so users could dismiss the error but never actually retry model loading.

---

## Decision

### 1. DomainModelId value object

A `DomainModelId` enum in `model-id.vo.ts` replaces all `string` model ID references throughout the domain, application, and UI layers:

```typescript
export enum DomainModelId {
  QWEN_2_5_3B = "qwen-2.5-3b",
  SMOLLM2_1_7B = "smollm2-1.7b",
  PHI3_MINI = "phi-3-mini",
}
```

The enum values (`"qwen-2.5-3b"`, etc.) are stable domain identifiers. The adapter maintains a private `MLC_IDS` map that translates them to MLC engine IDs (`"Qwen2.5-3B-Instruct-q4f16_1-MLC"`, etc.) at the infrastructure boundary.

The **only** place MLC engine IDs exist is inside `webllm.adapter.ts`. No other file imports or references them.

### 2. MODEL_METADATA_MAP — single source of truth

A `MODEL_METADATA_MAP: Record<DomainModelId, ModelMetadata>` keyed by domain ID provides the canonical metadata for each model. The `ModelMetadata` interface no longer has an `isLoaded` field (that was runtime state, not model metadata).

```typescript
export function getModelMetadata(modelId: DomainModelId): ModelMetadata {
  return MODEL_METADATA_MAP[modelId];
}
```

The adapter's `getLoadedModel()` now looks up `MODEL_METADATA[this.loadedModelId]` instead of returning hardcoded values. This was the root cause of the "all models show Alibaba, 3B, 32768" bug.

### 3. LLMInitializeConfig — renamed from ModelConfig

`ModelConfig` previously held `modelId`, `temperature`, and `maxTokens`. Temperature and maxTokens are tuning parameters that belong on `LLMCompletionRequest`, not on the initialization config. The rename to `LLMInitializeConfig` with only `modelId` makes the boundary explicit.

### 4. Result<T> for cache operations

`hasModelInCache` and `deleteCachedModel` on the port interface now return `Promise<Result<boolean>>` and `Promise<Result<void>>` respectively, matching the `Result` pattern already used by `initialize()` and `complete()`. The adapter wraps Worker responses in `ok()` / `err()`. The hook unwraps results for React components.

### 5. SyntheticEvent guard — arrow function wrapping

All `onInitialize` and `onRetry` handler props are now wrapped in arrow functions:

```tsx
<OptInCard onInitialize={() => initializeModel()} />
<ModelProgressCard onRetry={() => initializeModel()} />
```

This prevents React from forwarding the click event as the first argument to `initializeModel(modelId?: DomainModelId)`, which would produce "Unknown model ID: [object Object]".

### 6. Retry semantics — initializeModel instead of clearError

Both `LocalAssistantPanel` and `GovernanceAssistantPanel` now call `initializeModel()` on retry, not `clearError()`. The `clearError` function only clears `errorMessage` state — it does not attempt to load a model. "Retry" should mean "try loading again."

### 7. Model persistence via localStorage

`use-local-llm.tsx` stores the last successfully loaded model ID in `localStorage` under `hexagen:local-llm:last-model`. On mount, if `hexagen:local-llm:auto-load` is set, the hook reads the last model and calls `initializeModel(lastModelId)`. This makes model selection survive page refreshes.

### 8. Separate mapper module → inlined in adapter

An initial implementation placed the `MLC_IDS` and `MODEL_METADATA` maps in a separate `webllm-model-mapper.ts` module. This failed at runtime because `@hexagen/local-llm` uses `emitDeclarationOnly: true` — Next.js resolves the package via webpack alias to `src/`, transpiling `.ts` directly. The new module's import chain wasn't reliably picked up. The maps were inlined into `webllm.adapter.ts`, which is already on the transpilation path.

---

## Manifest changes

No new bounded contexts, ports, or use cases were added. All changes are within the `local-llm` bounded context and the `web` app's agent components.

**New files:**

- `packages/local-llm/src/domain/value-objects/model-id.vo.ts`

**Deleted files:**

- `packages/local-llm/src/infrastructure/adapters/webllm-model-mapper.ts`

**Modified files (domain):**

- `model-metadata.vo.ts` — `ModelMetadata.modelId: DomainModelId`; removed `isLoaded`; added `MODEL_METADATA_MAP`, `getModelMetadata()`; renamed `ModelConfig` → `LLMInitializeConfig`
- `llm-engine-state.vo.ts` — `loadedModelId: DomainModelId | null`
- `local-llm-provider.port.ts` — `LLMCompletionRequest.modelId: DomainModelId`; `LLMInitializeConfig` type; `hasModelInCache()`, `deleteCachedModel()` signatures

**Modified files (infrastructure):**

- `webllm.adapter.ts` — inlined `MLC_IDS` and `MODEL_METADATA`; domain ID translation at Worker boundary; cache methods with `Result<T>`; event listener cleanup in `initialize()`

**Modified files (app layer):**

- `use-local-llm.tsx` — `localStorage` persistence; `DomainModelId` types; `Result` unwrapping
- `LocalAssistantPanel.tsx` — arrow function guard; `onRetry` calls `initializeModel()`
- `GovernanceAssistantPanel.tsx` — arrow function guard; `onRetry` calls `initializeModel()`
- `ModelSettingsView.tsx`, `ModelFooterIndicator.tsx`, `ModelProgressCard.tsx` — `DomainModelId` typed props
- `config/models.ts` — `DomainModelId` enum values

**Modified files (tests):**

- `local-llm-provider.fake.ts` — `hasModelInCache()`, `deleteCachedModel()`; `DomainModelId` types
- `initialize-model.use-case.test.ts` — `DomainModelId.PHI3_MINI`; `MODEL_METADATA_MAP` fixture
- `stream-generate.use-case.test.ts` — `DomainModelId.PHI3_MINI`; `model` → `modelId`

---

## Consequences

### Positive

- Adding a new model requires exactly two changes: add an enum value to `DomainModelId` and add an entry to `MLC_IDS` and `MODEL_METADATA_MAP`. No other file needs updating.
- Domain layer (`model-id.vo.ts`, `model-metadata.vo.ts`) has zero infrastructure imports. The hexagonal dependency rule is enforced.
- All components, hooks, and use cases reference models by domain ID. MLC engine IDs never escape the adapter.
- Model metadata is correct per model instead of always showing "Alibaba, 3B, 32768".
- "Retry" in the error state now re-initializes the model instead of just clearing the error message.
- The `[object Object]` bug from SyntheticEvent forwarding is prevented by arrow function guards at every callsite.
- `Result<T>` wrapping on cache operations follows the same pattern as `initialize()` and `complete()` — no silent error swallowing.

### Negative

- Three supported models is a small enum; at ~10 models, `MODEL_METADATA_MAP` should be extracted to a config file or loaded from a registry. The current approach is pragmatic for the near term.
- `localStorage` persistence of model selection could conflict with an engine that disposes between page loads (the auto-load guard handles this gracefully — if initialization fails, the error state is shown).
- The inlined `MLC_IDS` and `MODEL_METADATA` maps in the adapter are not independently testable without mocking the adapter class. A future extraction to a config-driven approach would restore this separation.

### Neutral

- `DomainModelId` enum values are strings, not numeric indices, so they survive serialization (localStorage, Worker postMessage) without a custom serializer.
- The `DEFAULT_MODEL_ID` constant is named `DEFAULT_MODEL_ID` (not `DEFAULT_DOMAIN_MODEL_ID`). The shorter name was chosen to match the existing naming convention in the codebase.

---

## Learnings

1. **Separate modules in `emitDeclarationOnly` packages can fail at runtime.** When a package's `tsconfig.json` uses `emitDeclarationOnly: true`, only `.d.ts` files are emitted to `dist/`. Next.js resolves the package via webpack alias to `src/` and transpiles `.ts` directly — but the new module must already be on webpack's resolution path. If the import chain hasn't been visited during a previous build, the module resolves to `undefined`. **Remedy:** Keep maps inlined in the adapter when the package uses this compilation strategy.

2. **React SyntheticEvent forwarding is a silent hazard.** Any function with an optional first parameter that accepts `string | undefined` will silently receive the event object when passed directly as `onClick={fn}`. TypeScript does not catch this because `MouseEvent` satisfies the structural type check for `unknown`. **Remedy:** Always wrap callbacks in arrow functions when passing them as event handlers: `onClick={() => fn()}`.

3. **`clearError` is not a retry.** Clearing an error message without re-attempting the failed operation is a UX anti-pattern. "Retry" semantics require calling the original operation again, not just dismissing the error state.

4. **`Result<T, E>` with `E = unknown` requires type narrowing.** The default `E` parameter in our `Result<T, E>` type is `unknown`, so accessing `.error.message` requires narrowing with `result.success === false && result.error instanceof Error`. Tests that access `.error?.message` directly will produce LSP warnings but work at runtime. Future consideration: default `E` to `Error`.

---

## Verification

1. `yarn build && yarn typecheck && yarn lint` pass from a clean cache.
2. `yarn test` — all use-case tests pass with `DomainModelId.PHI3_MINI` and `MODEL_METADATA_MAP` fixtures.
3. `yarn lint:arch` — architecture is compliant with manifest.
4. No `@mlc-ai/web-llm` imports exist outside `webllm.adapter.ts` and `webllm.worker.ts`. Verified: `grep -r "@mlc-ai/web-llm" --include="*.ts" --include="*.tsx" apps/web/ packages/local-llm/` returns only those two files.
5. `grep -r "Qwen2\|SmolLM2\|Phi-3-mini" apps/web/ packages/local-llm/src/domain/ packages/local-llm/src/application/` returns zero matches — MLC IDs do not leak past the adapter.
6. All `onInitialize` and `onRetry` props in both panels use arrow function wrapping. Verified: `grep -n "onInitialize=\|onRetry=" apps/web/app/components/agent/` confirms no direct function references.

---

## Related

- ADR-0016: Local LLM Streaming Fixes (prior model ID and streaming work)
- `packages/local-llm/src/domain/value-objects/model-id.vo.ts`
- `packages/local-llm/src/infrastructure/adapters/webllm.adapter.ts`
- `apps/web/app/hooks/use-local-llm.tsx`
- `apps/web/app/components/agent/LocalAssistantPanel.tsx`
- `apps/web/app/components/agent/GovernanceAssistantPanel.tsx`
- Commits: `5d93db4`, `837284e`, `f47c16d`, `af1f12c`, `9d5e92d`, `2cf6307`
