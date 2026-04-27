# Stage 3 — ACL Cutover: Execution Plan

**Status:** COMPLETE ✅  
**Last Updated:** 2026-04-22  
**Locked Decisions:** S3.Q1–S3.Q8 (see below)

---

## Context

Stage 3 implements the LLM ACL (Anti-Corruption Layer) cutover — the core architectural fix for **CV-1** (raw `LLMMessage` leaked to UI) and **CV-6** (`LocalLLMProviderPort` monolith). The goal is to ensure that `apps/web` never constructs raw `LLMMessage[]` arrays; instead, all LLM interaction flows through `SendStructuredRequestPort` (structured) or `ModelLifecyclePort` (lifecycle ops).

## Locked Design Decisions

| ID    | Decision                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------- |
| S3.Q1 | Extend `SendStructuredRequestPort` with `streamStructuredRequest` method (same port, two modes) |
| S3.Q2 | Provide `FreeFormStringSchema` pass-through for chat; strict Zod for governance                 |
| S3.Q3 | Block runtime imports only; allow `import type` from `@hexagen/local-llm`                       |
| S3.Q4 | Split `LocalLLMProviderPort` → `ModelLifecyclePort` + `SendStructuredRequestPort`               |
| S3.Q5 | Defer cloud chat route ACL to Stage 3.5 follow-up                                               |
| S3.Q6 | Include `CompilePromptUseCase` dead-code fix in Phase A                                         |
| S3.Q7 | Inline red-path fixtures under `__tests__/fixtures/`                                            |
| S3.Q8 | Single PR bundling Phases B+C+D+E+F; Phase A merges independently                               |

## Phases

### Phase A — Foundation & Contracts

| Step | File                                                                            | Change                                                                          |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A.1  | `packages/local-llm/src/domain/value-objects/index.ts`                          | Fix duplicate `model-catalog.vo.js` re-export                                   |
| A.2  | `packages/local-llm/package.json`                                               | Add `exports` field per AGENTS.md §9; add `@hexagen/prompt-compiler` dependency |
| A.3  | `packages/local-llm/src/application/ports/in/send-structured-request.port.ts`   | Add `streamStructuredRequest` method                                            |
| A.4  | `packages/local-llm/src/domain/ports/model-lifecycle.port.ts`                   | **New file** — extract lifecycle methods from `LocalLLMProviderPort`            |
| A.5  | `packages/local-llm/src/application/ports/out/index.ts`                         | Re-export `ModelLifecyclePort`                                                  |
| A.6  | `packages/local-llm/src/application/index.ts`                                   | Chain `ports/in/` and `ports/out/` into root barrel                             |
| A.7  | `packages/prompt-compiler/src/application/use-cases/compile-prompt.use-case.ts` | Remove dead code (`systemInstruction` + `outputSchema`)                         |

**Exit Gate:** Build + typecheck + lint green. `SendStructuredRequestPort` and `ModelLifecyclePort` exist in barrel but have zero consumers yet. `LLMMessage` still publicly exported (intentional — Phase B internalizes it).

### Phase B — Barrel Surgery (intentional break)

| Step | File                                                             | Change                                                                                        |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| B.1  | `packages/local-llm/src/index.ts`                                | Remove `LLMMessage`, `LocalLLMProviderPort`, `complete`, `streamComplete` from public exports |
| B.2  | `packages/local-llm/src/domain/ports/local-llm-provider.port.ts` | Add `@internal` JSDoc tag to `LLMMessage`, `LLMCompletionRequest`                             |

**Expected:** `apps/web` typecheck breaks at 5 call sites. This is intentional and will be fixed in Phase D.

### Phase C — Wire Rewiring

| Step | File                       | Change                                                                            |
| ---- | -------------------------- | --------------------------------------------------------------------------------- |
| C.1  | `apps/web/app/lib/wire.ts` | Register `WebLLMAdapter` under `SendStructuredRequestPort` + `ModelLifecyclePort` |

### Phase D — Parallel Call-Site Migration

4 independent sub-agents on disjoint files:

| Sub | File(s)                                                                 | Migration                                                                                      |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| D.1 | `useChatMessages.ts`, `stream-assistant-response.ts`, `useLocalLlm.tsx` | `LLMMessage[]` → `sendStructuredRequest`/`streamStructuredRequest` with `FreeFormStringSchema` |
| D.2 | `useGovernanceThread.ts`                                                | `LLMMessage[]` → `sendStructuredRequest` with governance Zod schema                            |
| D.3 | `useGovernanceQuestionActions.ts`, `build-governance-prompt.ts`         | `LLMMessage[]` → `sendStructuredRequest` with governance Zod schema                            |
| D.4 | `useEngineLifecycle.ts`, `useModelCache.ts`, `useAutoInitLastModel.ts`  | `LocalLLMProviderPort` → `ModelLifecyclePort`                                                  |

**Exit Gate:** All call sites use new ports. `apps/web` typecheck green.

### Phase E — Layer 2 + Layer 3 Enforcement

| Step | File                                     | Change                                                                                                                                |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| E.1  | `apps/web/eslint.config.js`              | Add `no-restricted-imports` rule blocking runtime `LLMMessage`/`LocalLLMProviderPort` from `@hexagen/local-llm` (allow `import type`) |
| E.2  | `scripts/validate-ui-boundary.sh`        | Extend to cover `apps/web` + check for `LLMMessage` references                                                                        |
| E.3  | `packages/local-llm/__tests__/fixtures/` | Red-path fixtures for ACL enforcement tests                                                                                           |

### Phase F — Verification & Documentation

| Step | File                                                         | Change                                                              |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| F.1  | `.architecture/decisions/0021-prompt-compilation-llm-acl.md` | Update with implemented ACL shape                                   |
| F.2  | `docs/code-review-2026-04-22.md`                             | Mark Stage 3 complete                                               |
| F.3  | `packages/local-llm/__tests__/`                              | Barrel-shape unit test verifying `LLMMessage` not in public exports |

---

## Key Files Reference

### Current State (pre-Stage 3)

- `packages/local-llm/src/domain/ports/local-llm-provider.port.ts` — monolith port with `LLMMessage` (lines 9-12), 7 methods
- `packages/local-llm/src/application/ports/in/send-structured-request.port.ts` — exists but unreachable from barrel
- `packages/local-llm/src/application/index.ts` — does NOT re-export `ports/in/`
- `packages/local-llm/src/infrastructure/adapters/webllm.adapter.ts` — already implements both ports
- `apps/web/app/lib/wire.ts` — only wires `LocalLLMProviderPort`
- 5 `LLMMessage[]` construction sites in `apps/web/`

### New Files to Create

- `packages/local-llm/src/domain/ports/model-lifecycle.port.ts`
- `packages/local-llm/src/application/ports/out/index.ts` (if not exists)
- `packages/local-llm/__tests__/fixtures/` (red-path fixtures)
- `packages/local-llm/__tests__/barrel-shape.test.ts`

### Dependency Alignment

- `packages/local-llm/package.json`: add `@hexagen/prompt-compiler` to dependencies (currently a latent violation — `webllm.adapter.ts` imports `validateStructuredOutput` at runtime)

---

## Previous Stages Summary

| Stage                      | Status | Key Outcome                                                                                          |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| 0 — STABILIZE              | ✅     | Build green; 36 build artifacts deleted; src/ purity guard script                                    |
| 1 — GOVERNANCE REALIGNMENT | ✅     | ADR 0018/0005 filled; planes overlay added; manifest reconciled; root cleanup                        |
| 2 — CLOSE MIGRATION        | ✅     | Duplicate adapters removed; 6 app files deleted; 20 imports switched; `serializeWizardContext` added |
| 5 — MVK DRIFT FIX          | ✅     | `BaseDomainCommand`/`lineageId`/`timestamp` removed; drift test added                                |
| 3 — ACL CUTOVER            | 🔨     | Phase A starting                                                                                     |
| 4 — FIREWALL HARDENING     | ⏳     | Pending                                                                                              |
| 6 — CLEANUP                | ⏳     | Pending                                                                                              |
