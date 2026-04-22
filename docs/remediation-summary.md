# Remediation Summary — Code Review for Final Approval

**Date:** 2026-04-22  
**Scope:** Full monorepo remediation (7 stages, 7 Critical Violations + 17 Architectural Smells)  
**Diff Size:** 65 files modified, ~793 insertions, ~2780 deletions, 15 new files  
**Verification:** `yarn build && yarn typecheck && yarn lint && yarn lint:arch` — all green

---

## Table of Contents

1. [Critical Violations Resolved](#1-critical-violations-resolved)
2. [Architectural Smells Resolved](#2-architectural-smells-resolved)
3. [Stage-by-Stage Change Inventory](#3-stage-by-stage-change-inventory)
4. [New Files Created](#4-new-files-created)
5. [Files Deleted](#5-files-deleted)
6. [Key Architectural Decisions Locked](#6-key-architectural-decisions-locked)
7. [Deferred Items](#7-deferred-items)
8. [Verification Commands](#8-verification-commands)

---

## 1. Critical Violations Resolved

| CV   | Description                             | Resolution                                                                                                                                                                 | Stage |
| ---- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| CV-1 | Raw `LLMMessage[]` leaked to UI         | `LLMMessage` marked `@internal`; all call sites migrated to `SendStructuredRequestPort` + `LLMRequest["messages"]`                                                         | 3     |
| CV-2 | Build artifacts in `src/`               | 36 files deleted (`.js`, `.d.ts`, `.d.ts.map` from `core-domain/src/mvk/v1/`); purity guard script added                                                                   | 0     |
| CV-3 | Broken build                            | Fixed `import type` → `import` for enum, relative path for self-import, barrel exports, model-catalog re-export                                                            | 0     |
| CV-4 | LLM ACL bypassed at input               | `SendStructuredRequestPort` + `ModelLifecyclePort` created; `FreeFormStringSchema` for chat; `streamStructuredRequest` for streaming; ESLint + boundary script enforcement | 3     |
| CV-5 | 3-layer firewall structurally defective | `NoSemanticState<T>` fixed (Omit forbidden keys); `@hexagen/eslint-plugin-ui` created; shared `firewall-blocklist.yaml`; boundary script rewritten                         | 4     |
| CV-6 | ADR 0018 stub; ADR 0005 empty           | ADR 0018 rewritten with full Q1–Q13 content (Accepted); ADR 0005 filled with shared-kernel documentation                                                                   | 1     |
| CV-7 | MVK `DomainCommand` drift from spec     | `BaseDomainCommand`, `lineageId`, `timestamp` removed; drift test added; spec ↔ TS shape-equivalent                                                                        | 5     |

---

## 2. Architectural Smells Resolved

| AS    | Description                                  | Resolution                                                                                                                                                        | Stage |
| ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| AS-1  | Duplicate/zombie adapters in prompt-compiler | Deleted `grounded-prompt-builder.adapter.ts` + `migrated-wizard-context-serializer.adapter.ts`; renamed `MigratedGroundedPromptAdapter` → `GroundedPromptAdapter` | 2     |
| AS-2  | Phase 7 presented as complete                | Updated plan documents; removed false claims                                                                                                                      | 1     |
| AS-3  | Manifest dual-truth with filesystem          | Reconciled manifest ↔ filesystem; added phantom BCs, runtime BC, expanded ui BC                                                                                   | 1     |
| AS-4  | Three contradictory planning documents       | Retained on-disk plan as canonical (D1); retracted Batch 1 & 2 claims                                                                                             | 1     |
| AS-5  | Root-directory clutter                       | Moved 4 MANIFEST_AUTOMATION files to `docs/manifest-automation/`; deleted `files.log`, `trace.log`, `SYNC-MIGRATION-REPORT.md`                                    | 1     |
| AS-6  | UI brand helpers in `value_objects`          | Moved to `types` section in manifest                                                                                                                              | 6     |
| AS-8  | wire.ts composition-root kernel-awareness    | Documented as accepted exception in `layer-rules.yaml`                                                                                                            | 6     |
| AS-9  | Inert root manifest `no-restricted-imports`  | Removed from manifest (superseded by `linter-config.yaml`)                                                                                                        | 6     |
| AS-10 | Phantom bounded contexts                     | Downgraded from `type: core` to `type: supporting, status: scaffold`                                                                                              | 6     |
| AS-11 | No `planes:` overlay                         | Added 5-plane overlay to manifest (kernel, projection, probabilistic, infrastructure, shared-kernel)                                                              | 1     |
| AS-16 | Empty `packages/ui/__tests__/`               | Populated with `no-semantic-state.test.ts` + `forbidden-tokens.test.ts`                                                                                           | 4, 6  |

---

## 3. Stage-by-Stage Change Inventory

### Stage 0 — STABILIZE

**Goal:** Make the build green.

| File                                                      | Change                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/core-domain/src/mvk/v1/*.{js,d.ts,d.ts.map}`    | Deleted 36 build artifacts                                     |
| `packages/local-llm/src/domain/model-catalog.ts`          | **New:** `import` (not `import type`) for `DomainModelId` enum |
| `packages/local-llm/src/domain/cloud-provider-catalog.ts` | **New:** cloud provider catalog migrated from app              |
| `packages/local-llm/src/domain/value-objects/index.ts`    | Fixed duplicate `model-catalog.vo.js` re-export                |
| `packages/local-llm/src/domain/index.ts`                  | Added `model-catalog.js` + `cloud-provider-catalog.js` exports |
| `apps/web/app/lib/model-recommendation.ts` → deleted      | Replaced by direct `@hexagen/local-llm` imports                |
| `scripts/validate-src-purity.sh`                          | **New:** CI guard for build artifacts in `src/`                |

### Stage 1 — GOVERNANCE REALIGNMENT

**Goal:** Fix governance artifacts (ADRs, manifest, root clutter).

| File                                                               | Change                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `.architecture/decisions/0018-mvk-semantic-kernel-contracts.md`    | Rewritten: Draft → Accepted, full Q1–Q13 content                                                                            |
| `.architecture/decisions/0005-shared-kernel-type-migration.md`     | Filled from 0 bytes to complete documentation                                                                               |
| `.architecture/manifest.yaml`                                      | Added `planes:` overlay (5 planes); reconciled manifest ↔ filesystem; added runtime BC, expanded ui BC, added 3 phantom BCs |
| `.architecture/invariants/layer-rules.yaml`                        | Added `@hexagen/runtime` to shared_kernels                                                                                  |
| `.architecture/invariants/linter-config.yaml`                      | Added runtime package_rules entry                                                                                           |
| `.architecture/plans/phase-3-7-execution-plan-v1.md`               | Updated status line + phase completion table                                                                                |
| Root MANIFEST*AUTOMATION*\*.md files → `docs/manifest-automation/` | Moved 4 files; deleted `files.log`, `trace.log`, `SYNC-MIGRATION-REPORT.md`                                                 |

### Stage 2 — CLOSE MIGRATION

**Goal:** Complete Phase 7 app→package migration; eliminate duplicates.

| File                                                                                                 | Change                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/prompt-compiler/src/infrastructure/adapters/grounded-prompt-builder.adapter.ts`            | **Deleted:** duplicate adapter                                                  |
| `packages/prompt-compiler/src/infrastructure/adapters/migrated-wizard-context-serializer.adapter.ts` | **Deleted:** duplicate adapter                                                  |
| `packages/prompt-compiler/src/infrastructure/adapters/migrated-grounded-prompt.adapter.ts`           | Renamed class: `MigratedGroundedPromptAdapter` → `GroundedPromptAdapter`        |
| `packages/prompt-compiler/src/infrastructure/adapters/index.ts`                                      | Removed deleted adapter exports                                                 |
| `packages/prompt-compiler/src/domain/wizard-context-serializer.ts`                                   | **New:** standalone `serializeWizardContext` function                           |
| `packages/prompt-compiler/src/domain/index.ts`                                                       | Added `wizard-context-serializer` export                                        |
| `apps/web/app/lib/grounded-prompt.ts`                                                                | **Deleted:** 0 consumers                                                        |
| `apps/web/app/lib/model-recommendation.ts`                                                           | **Deleted:** replaced by direct `@hexagen/local-llm` imports                    |
| `apps/web/app/lib/governance-question-templates.ts`                                                  | **Deleted:** migrated to `@hexagen/prompt-compiler`                             |
| `apps/web/app/lib/wizard-assistant-context.ts`                                                       | **Deleted:** migrated to `@hexagen/prompt-compiler`                             |
| `apps/web/app/config/models.ts`                                                                      | **Deleted:** duplicate of `@hexagen/local-llm/domain/model-catalog.ts`          |
| `apps/web/app/config/cloud-providers.ts`                                                             | **Deleted:** duplicate of `@hexagen/local-llm/domain/cloud-provider-catalog.ts` |
| `apps/web/app/config/` directory                                                                     | **Deleted:** entire directory removed                                           |
| 20 consumer imports across `apps/web/`                                                               | Switched to `@hexagen/local-llm`, `@hexagen/prompt-compiler`                    |

### Stage 3 — ACL CUTOVER

**Goal:** Enforce LLM Anti-Corruption Layer; eliminate raw `LLMMessage[]` from app code.

**Phase A — Foundation & Contracts:**

| File                                                                            | Change                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/local-llm/src/domain/value-objects/index.ts`                          | Fixed duplicate `model-catalog.vo.js`                                        |
| `packages/local-llm/package.json`                                               | Added `exports` field; added `@hexagen/prompt-compiler` + `zod` dependencies |
| `packages/local-llm/src/application/ports/in/send-structured-request.port.ts`   | Added `streamStructuredRequest` method + `FreeFormStringSchema` constant     |
| `packages/local-llm/src/domain/ports/model-lifecycle.port.ts`                   | **New:** extracted lifecycle methods from `LocalLLMProviderPort`             |
| `packages/local-llm/src/domain/ports/index.ts`                                  | Added `model-lifecycle.port.js` re-export                                    |
| `packages/local-llm/src/application/index.ts`                                   | Chained `ports/in/` into root barrel                                         |
| `packages/local-llm/src/application/ports/in/index.ts`                          | Cleaned: only re-exports `send-structured-request.port`                      |
| `packages/prompt-compiler/src/application/use-cases/compile-prompt.use-case.ts` | Removed dead code (unused `systemInstruction` + `outputSchema`)              |

**Phase B — @internal Markers:**

| File                                                             | Change                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/local-llm/src/domain/ports/local-llm-provider.port.ts` | Added `@internal` JSDoc to `LLMMessage`, `LLMCompletionRequest`, `LocalLLMProviderPort` |

**Phase C — Wire Rewiring:**

| File                       | Change                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/lib/wire.ts` | Imported `ModelLifecyclePort` + `SendStructuredRequestPort`; registered both new ports; added `getModelLifecycle()` + `getSendStructuredRequest()` getters |

**Phase D — Call-Site Migrations:**

| File                                                                                                | Change                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/hooks/local-llm/stream-assistant-response.ts`                                         | **Rewritten:** `LocalLLMProviderPort.streamComplete()` → `SendStructuredRequestPort.streamStructuredRequest()` with `LLMRequest` + `FreeFormStringSchema` |
| `apps/web/app/hooks/local-llm/useChatMessages.ts`                                                   | **Rewritten:** `LLMMessage[]` → `LLMRequest["messages"]`; `LocalLLMProviderPort` → `ModelLifecyclePort & SendStructuredRequestPort`                       |
| `apps/web/app/hooks/useLocalLlm.tsx`                                                                | `LLMMessage[]` → `LLMRequest["messages"]` in `sendGovernanceMessage` signature                                                                            |
| `apps/web/features/governance-assistant/hooks/governance-assistant/useGovernanceThread.ts`          | `LLMMessage[]` → `LLMRequest["messages"]` throughout                                                                                                      |
| `apps/web/features/governance-assistant/hooks/governance-assistant/useGovernanceQuestionActions.ts` | `LLMMessage` → `LLMRequest["messages"]` in signatures                                                                                                     |
| `apps/web/app/hooks/local-llm/useEngineLifecycle.ts`                                                | `LocalLLMProviderPort` → `ModelLifecyclePort & SendStructuredRequestPort`; `getLocalLLMProvider` → `getModelLifecycle`                                    |
| `apps/web/app/hooks/local-llm/useModelCache.ts`                                                     | `LocalLLMProviderPort` → `ModelLifecyclePort & SendStructuredRequestPort`                                                                                 |

**Phase E — Enforcement:**

| File                                                             | Change                                                                                                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/eslint.config.js`                                      | Added `no-restricted-imports` blocking runtime `LLMMessage`/`LocalLLMProviderPort` (allows `import type`); added `hexagen-ui/no-feature-slice-imports` rule |
| `scripts/validate-ui-boundary.sh`                                | Extended: added Check 5 (runtime @internal ACL imports) + Check 6 (cross-slice detection)                                                                   |
| `packages/local-llm/__tests__/fixtures/acl-barrel-shape.test.ts` | **New:** barrel-shape structural test                                                                                                                       |

**Phase F — Documentation:**

| File                                                         | Change                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `.architecture/decisions/0021-prompt-compilation-llm-acl.md` | Added "Implementation Status" section documenting the completed ACL cutover |
| `docs/code-review-2026-04-22.md`                             | Stage 3 marked complete with implementation details                         |
| `docs/stage3-acl-cutover-plan.md`                            | **New:** detailed Stage 3 execution plan                                    |
| `.architecture/plans/phase-3-7-execution-plan-v1.md`         | Phase 5.B atomic units marked complete with status column                   |

### Stage 4 — FIREWALL HARDENING

**Goal:** Fix all 3 layers of the information-state firewall; remove cross-slice imports.

**F4.1 — Layer 1 (TypeScript brands):**

| File                                              | Change                                                                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/types/forbidden-brand.ts`        | `NoSemanticState<T>` changed from `T & __HexagenSemanticState` (ineffective) to `Omit<T, ForbiddenPropKeys> & __HexagenSemanticState` (strips forbidden keys); simplified `ForbiddenPropKeys` to `keyof ForbiddenInformationState` |
| `packages/ui/__tests__/no-semantic-state.test.ts` | **New:** type-level test proving `NoSemanticState<Widget>` removes `loading`/`data`/`error` from type surface                                                                                                                      |

**F4.2 — Layer 2 (ESLint plugin):**

| File                                    | Change                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/eslint-plugin-ui/`            | **New package** with 3 rules:                                                    |
| `src/rules/no-information-state.ts`     | Blocks forbidden prop names (`data`, `loading`, `error`, etc.) in JSX attributes |
| `src/rules/no-kernel-imports.ts`        | Blocks kernel-plane package imports in UI/projection code                        |
| `src/rules/no-feature-slice-imports.ts` | Blocks cross-feature-slice imports (workspace-shell exempted)                    |
| `apps/web/eslint.config.js`             | Integrated `hexagen-ui` plugin; `no-feature-slice-imports` on `features/**`      |
| `packages/ui/eslint.config.mjs`         | Added missing kernel packages to `no-restricted-imports` patterns                |
| `apps/web/package.json`                 | Added `@hexagen/eslint-plugin-ui` + `@hexagen/prompt-compiler` dependencies      |

**F4.3 — Layer 3 (CI shell script):**

| File                              | Change                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/firewall-blocklist.yaml` | **New:** single source of truth for kernel_packages, forbidden_prop_names, allowed_hexagen_imports, acl_internal_types               |
| `scripts/validate-ui-boundary.sh` | **Rewritten:** reads from `firewall-blocklist.yaml`; Check 3 is now ERROR (not warning); added Check 5 (ACL) + Check 6 (cross-slice) |

**F4.4 — Cross-slice imports:**

| File                                                                                          | Change                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/features/governance-assistant/hooks/governance-assistant/derive-governance-keys.ts` | Removed `import { wizardSteps } from "../../../project-wizard/config"`; now uses `WIZARD_STEP_ORDER` from `@hexagen/prompt-compiler` |
| `packages/prompt-compiler/src/domain/governance-question-templates.ts`                        | Added `WIZARD_STEP_ORDER` constant                                                                                                   |
| `apps/web/features/code-view/CodeView.tsx`                                                    | Replaced cross-slice import of `EditableMonaco` with `editorSlot` render prop; added `editorSlot` to `CodeViewProps`                 |
| `apps/web/features/workspace-shell/ArchitecturePreviewPane.tsx`                               | Injects `EditableMonaco` via `editorSlot` prop (composition root pattern)                                                            |

### Stage 5 — MVK DRIFT FIX

**Goal:** Align `DomainCommand` TS implementation with canonical spec.

| File                                                                 | Change                                                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core-domain/src/mvk/v1/domain-command.ts`                  | Removed `BaseDomainCommand` class; removed `lineageId` + `timestamp` fields; all 7 command interfaces now carry only `type` + `payload` |
| `packages/core-domain/__tests__/mvk/v1/domain-command-drift.test.ts` | **New:** machine-enforced spec↔TS drift test                                                                                            |
| `.architecture/mvk/drift-report-v1.md`                               | Added "Resolved Drift" section for compilation pass `cp-2026-04-22-01`                                                                  |

### Stage 6 — CLEANUP

**Goal:** Address remaining architectural smells.

| File                                             | Change                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.architecture/manifest.yaml`                    | (1) UI brand helpers moved from `value_objects` → `types`; (2) phantom BCs `architectural-enforcement` + `code-generation` changed from `type: core` → `type: supporting, status: scaffold`; (3) removed inert root `no-restricted-imports` rule |
| `.architecture/invariants/layer-rules.yaml`      | Added `composition_root_exceptions:` section documenting `wire.ts` accepted leak                                                                                                                                                                 |
| `packages/ui/__tests__/forbidden-tokens.test.ts` | **New:** test for `FORBIDDEN_TOKENS` array + `isForbiddenToken` type guard                                                                                                                                                                       |

---

## 4. New Files Created

| Path                                                                 | Purpose                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/local-llm/src/domain/model-catalog.ts`                     | Model catalog migrated from app                           |
| `packages/local-llm/src/domain/cloud-provider-catalog.ts`            | Cloud provider catalog migrated from app                  |
| `packages/local-llm/src/domain/ports/model-lifecycle.port.ts`        | Extracted lifecycle port from `LocalLLMProviderPort`      |
| `packages/prompt-compiler/src/domain/wizard-context-serializer.ts`   | Standalone `serializeWizardContext` function              |
| `packages/core-domain/__tests__/mvk/v1/domain-command-drift.test.ts` | Spec↔TS drift test                                        |
| `packages/local-llm/__tests__/fixtures/acl-barrel-shape.test.ts`     | ACL barrel-shape structural test                          |
| `packages/eslint-plugin-ui/`                                         | **New package:** `@hexagen/eslint-plugin-ui` with 3 rules |
| `packages/ui/__tests__/no-semantic-state.test.ts`                    | Type-level firewall test                                  |
| `packages/ui/__tests__/forbidden-tokens.test.ts`                     | Forbidden token helpers test                              |
| `scripts/validate-src-purity.sh`                                     | CI guard for build artifacts in `src/`                    |
| `scripts/firewall-blocklist.yaml`                                    | Single source of truth for firewall blocklists            |
| `docs/code-review-2026-04-22.md`                                     | Canonical remediation plan                                |
| `docs/stage3-acl-cutover-plan.md`                                    | Stage 3 execution plan                                    |
| `docs/manifest-automation/`                                          | 4 MANIFEST_AUTOMATION files relocated from root           |

---

## 5. Files Deleted

| Path                                                                                                 | Reason                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core-domain/src/mvk/v1/*.{js,d.ts,d.ts.map}`                                               | 36 build artifacts in `src/` (CV-2)                                |
| `packages/prompt-compiler/src/infrastructure/adapters/grounded-prompt-builder.adapter.ts`            | Duplicate adapter (AS-1)                                           |
| `packages/prompt-compiler/src/infrastructure/adapters/migrated-wizard-context-serializer.adapter.ts` | Duplicate adapter (AS-1)                                           |
| `apps/web/app/lib/grounded-prompt.ts`                                                                | 0 consumers, dead code                                             |
| `apps/web/app/lib/model-recommendation.ts`                                                           | Replaced by direct `@hexagen/local-llm` imports                    |
| `apps/web/app/lib/governance-question-templates.ts`                                                  | Migrated to `@hexagen/prompt-compiler`                             |
| `apps/web/app/lib/wizard-assistant-context.ts`                                                       | Migrated to `@hexagen/prompt-compiler`                             |
| `apps/web/app/config/models.ts`                                                                      | Duplicate of `@hexagen/local-llm/domain/model-catalog.ts`          |
| `apps/web/app/config/cloud-providers.ts`                                                             | Duplicate of `@hexagen/local-llm/domain/cloud-provider-catalog.ts` |
| `apps/web/app/config/` directory                                                                     | Removed entirely                                                   |
| `MANIFEST_AUTOMATION_ARCHITECTURE.md`                                                                | Root clutter (AS-5)                                                |
| `MANIFEST_AUTOMATION_INDEX.md`                                                                       | Root clutter (AS-5)                                                |
| `MANIFEST_AUTOMATION_REPORT.md`                                                                      | Root clutter (AS-5)                                                |
| `MANIFEST_AUTOMATION_SUMMARY.md`                                                                     | Root clutter (AS-5)                                                |
| `files.log`                                                                                          | Root clutter (D5)                                                  |
| `trace.log`                                                                                          | Root clutter (D5)                                                  |
| `SYNC-MIGRATION-REPORT.md`                                                                           | Root clutter (D5)                                                  |

---

## 6. Key Architectural Decisions Locked

| Decision | Description                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| D1       | Canonical plan is `.architecture/plans/phase-3-7-execution-plan-v1.md`; retire Batch 1 & 2                                 |
| D2       | Remove `lineageId` + `timestamp` from `DomainCommand`; keep on `IntentLineage`                                             |
| D3       | Hard ACL cutover — remove `LLMMessage` from `@hexagen/local-llm` public exports                                            |
| D4       | `hexagen-ui/*` rules apply to `packages/ui/**` AND `apps/web/features/**`                                                  |
| D5       | Move `MANIFEST_AUTOMATION_*.md` → `docs/manifest-automation/`; delete `files.log`, `trace.log`, `SYNC-MIGRATION-REPORT.md` |
| S3.Q1    | Extend `SendStructuredRequestPort` with `streamStructuredRequest` (same port, two modes)                                   |
| S3.Q2    | Provide `FreeFormStringSchema` pass-through for chat; strict Zod for governance                                            |
| S3.Q3    | Block runtime imports only; allow `import type` from `@hexagen/local-llm`                                                  |
| S3.Q4    | Split `LocalLLMProviderPort` → `ModelLifecyclePort` + `SendStructuredRequestPort`                                          |
| S3.Q5    | Defer cloud chat route ACL to Stage 3.5 follow-up                                                                          |
| S3.Q6    | Include `CompilePromptUseCase` dead-code fix in Phase A                                                                    |
| S3.Q7    | Inline red-path fixtures under `__tests__/fixtures/`                                                                       |
| S3.Q8    | Single PR bundling Phases B+C+D+E+F; Phase A merges independently                                                          |

---

## 7. Deferred Items

| Item                                                        | Reason                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Stage 3.5 — Cloud chat route ACL (`/api/llm/chat/route.ts`) | Server-side route uses `OpenAICompatibleAdapter` directly; requires separate design for server-context ACL |
| AS-13 — `generator.config.yaml` ownership registry          | Protected file per AGENTS.md §2; `yarn sync` managed                                                       |
| AS-15 — `@hexagen/ui` subpath codemod                       | No consumers yet; premature optimization                                                                   |
| AS-7 — `emitDeclarationOnly` inconsistency                  | Base config issue; affects build pipeline globally; separate PR                                            |
| AS-12 — `tsconfig.base.json` paths + composite interaction  | Complex cross-cutting change; separate PR                                                                  |
| AS-14 — `apps/web/app/hooks/**` unregistered slice          | Design decision needed on slice registration model                                                         |

---

## 8. Verification Commands

```bash
# Full build + typecheck + lint + arch-lint
yarn build && yarn typecheck && yarn lint && yarn lint:arch

# Simulate clean CI (no turbo cache)
rm -rf packages/*/dist .turbo node_modules/.cache
find . -name "*.tsbuildinfo" -delete
yarn build && yarn typecheck

# Verify no LLMMessage[] in apps/web (should return 0 lines)
rg 'LLMMessage\[\]' apps/web/ --type ts

# Verify no runtime LLMMessage/LocalLLMProviderPort imports in features
rg 'import\s+\{[^}]*\b(LLMMessage|LocalLLMProviderPort)\b' apps/web/features/ --type ts

# Run boundary script
bash scripts/validate-ui-boundary.sh

# Run src purity check
bash scripts/validate-src-purity.sh

# Run drift test
yarn test --filter core-domain
```

---

## Architectural Summary (for quick reference)

**Before:** Broken build, raw `LLMMessage[]` leaked to UI, `NoSemanticState<T>` was a no-op, empty test directories, duplicate adapters, 36 build artifacts in `src/`, empty ADRs, phantom bounded contexts, no ESLint enforcement, no cross-slice isolation, `DomainCommand` drifted from spec.

**After:** Green build + typecheck + lint + arch-lint. ACL enforced via `SendStructuredRequestPort` + `ModelLifecyclePort` with 3-layer enforcement (TS brands, ESLint plugin, CI script). Firewall functional (`NoSemanticState` strips forbidden keys). All migrations complete (20 imports switched, 6 app files deleted). Spec ↔ code aligned with machine-enforced drift test. Governance artifacts filled and accepted.
