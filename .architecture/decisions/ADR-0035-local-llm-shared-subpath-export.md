# ADR-0035: `@hexagen/local-llm/shared` subpath export for server-safe domain types

**Status:** Accepted
**Date:** 2026-05-08
**Deciders:** Engineering

---

## Context

`@hexagen/local-llm` exported browser-only infrastructure adapters and pure
domain types from a single entry point (`src/index.ts`). The browser adapters
(`WebLLMAdapter`, `IDBChatPersistenceAdapter`, `BrowserHardwareProfilerAdapter`,
`WebGPUCapabilityAdapter`) access `indexedDB`, `navigator.gpu`, `Worker`, and
other browser-only globals at module load time.

Server-side code in `@hexagen/agentic-interaction` and
`@hexagen/manifest-generation` legitimately needed the domain types and
factories (`createLLMRequest`, `createLLMResponse`, `DomainModelId`, port
interfaces). Because these lived in the same barrel as the browser adapters,
any server-side import of a value from `@hexagen/local-llm` caused webpack to
pull the entire module graph into the SSR bundle. When Node.js evaluated
those modules it accessed browser-only APIs and threw a `DOMException`.

In Node.js 22+, `localStorage` and similar Web Storage APIs are exposed as
globals but require `--localstorage-file` to initialise. Accessing them
without that flag throws a `SecurityError` (a `DOMException`). The error
manifested as a noisy cascade in the Next.js dev server:
`logErrorWithOriginalStack` attempted `error.message = ...` on the
`DOMException`, whose `message` property is a getter-only accessor, producing
a secondary `TypeError: Cannot set property message of <DOMException> which
has only a getter`. The secondary error obscured the original source for an
extended debugging period.

The immediate trigger was `modelPreferencesStorage.ts` calling `localStorage`
synchronously during SSR of `GenerateWithAi` (fixed separately, see
ADR-0036). The module graph contamination was a distinct structural problem
that needed to be fixed regardless.

---

## Decision

Add a `./shared` subpath export to `@hexagen/local-llm` that re-exports only
server-safe symbols. All server-side consumers switch from
`@hexagen/local-llm` to `@hexagen/local-llm/shared` for value imports.

### Package exports

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js",
    "source": "./src/index.ts"
  },
  "./shared": {
    "types": "./dist/shared/index.d.ts",
    "default": "./dist/shared/index.js",
    "source": "./src/shared/index.ts"
  }
}
```

`source` is listed last so bundlers that do not recognise it fall through to
`default` rather than resolving the raw TypeScript file.

### `src/shared/index.ts` contents

Re-exports only from `domain/value-objects/`, `domain/ports/`, `domain/`,
and `application/ports/in/`. No imports from `infrastructure/` or
`application/use-cases/`.

Explicitly excluded:

- `WebLLMAdapter` — uses `Worker`, WebGPU
- `IDBChatPersistenceAdapter` — uses `indexedDB`
- `BrowserHardwareProfilerAdapter` — uses `navigator.gpu`
- `WebGPUCapabilityAdapter` — uses `navigator.gpu`
- Application use cases that transitively import the above

### Main entry point

The main `src/index.ts` is intentionally **not** updated to re-export from
`./shared`. This makes the main entry browser-only by convention and prevents
future regressions where a new server-side consumer imports from the wrong
path. The pain of a compile error is preferable to silent SSR contamination.

### ESLint enforcement

`no-restricted-imports` in `.eslintrc.json` adds `@hexagen/local-llm/shared`
as a permitted exception alongside the existing allowlist. Server-side code
that imports from `@hexagen/local-llm` (main) will trigger the lint rule.

### Files migrated

All value imports in the following packages were updated:

**`@hexagen/agentic-interaction`**

- `infrastructure/adapters/cloud-llm-pipeline.adapter.ts`
- `infrastructure/adapters/cloud-llm-streaming.ts`
- `infrastructure/adapters/in-memory-pipeline-ports.adapter.ts`
- `infrastructure/adapters/llm-provider-selector.adapter.ts`
- `application/use-cases/fix-manifest-violation.use-case.ts`
- `application/use-cases/holistic-manifest-repair.use-case.ts`
- `application/use-cases/modify-architecture.use-case.ts`
- `application/use-cases/llm-retry.ts`
- `application/use-cases/staged-generation/execute-*.use-case.ts` (×6)

**`@hexagen/manifest-generation`**

- `application/services/manifest-capability-assessor.service.ts`
- `application/ports/out/model-preferences.port.ts`
- `application/ports/out/model-verification.port.ts`
- `application/use-cases/model-download-orchestrator.use-case.ts`
- `domain/services/model-selection-state-machine.ts`
- `domain/services/model-verification-service.ts`
- `infrastructure/adapters/model-preferences.adapter.ts`

---

## Consequences

**Positive**

- `@hexagen/local-llm` browser adapters no longer appear in any server-side
  webpack chunk.
- The boundary is structural: a new engineer importing from the main entry
  server-side fails lint before the code ships.
- No new packages, no workspace configuration changes.
- `fix-esm-barrels.js` handles `dist/shared/` automatically via its
  recursive `walk()` function — no script changes required.

**Negative / trade-offs**

- Every server-side consumer of `@hexagen/local-llm` types must use the
  `/shared` subpath. Forgetting this is a lint error, not a type error, so it
  is caught at `yarn lint` time rather than at compile time.
- The `./shared` barrel must be kept in sync as new domain types are added to
  `@hexagen/local-llm`. Adding a type to `src/domain/` without adding it to
  `src/shared/index.ts` will cause a confusing "not exported" error for
  server-side consumers.

**Neutral**

- Client-side code (`apps/web/features/`, `wire.client.ts`) continues to
  import from `@hexagen/local-llm` (main) unchanged.
- `import type` from either path continues to work on both sides — type
  imports are erased entirely at compile time and never affect the module
  graph.
