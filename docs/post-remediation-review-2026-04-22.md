# HexaGen Monaco — Post-Remediation Review Report

**Mode:** Review & Archeology (read-only)
**Date:** 2026-04-22
**Scope:** Full assessment of post-remediation state + phased plan for remaining work

---

## 1. Executive Summary

The 7-stage remediation (Stages 0-6) successfully resolved all 7 Critical Violations and 12 Architectural Smells documented in `docs/code-review-2026-04-22.md`. The build is green, the LLM ACL is enforced on the client side, the 3-layer information-state firewall is functional, MVK drift is fixed, and governance artifacts are filled.

However, the remediation deferred 6 items, and this review has uncovered 7 additional findings — totalling **13 open items** across 3 severity tiers. The most critical is the cloud chat route ACL bypass (Stage 3.5) and the unregistered hooks slice that tunnels kernel imports past the firewall.

### Scorecard

| Area                       | Pre-Remediation                 | Post-Remediation               | Target              |
| -------------------------- | ------------------------------- | ------------------------------ | ------------------- |
| Build health               | Broken (CV-1/CV-2)              | Green                          | Green               |
| LLM ACL (client)           | Unenforced (12+ bypass sites)   | Enforced (3 layers)            | Enforced            |
| LLM ACL (server)           | Unenforced                      | **Still unenforced**           | Enforced            |
| Information-state firewall | Structurally defective          | Functional (8/11 tokens at L1) | 11/11 at all layers |
| MVK spec/code alignment    | Drifted                         | Aligned + drift test           | Aligned             |
| Governance docs            | 2 empty ADRs, no planes overlay | 22 ADRs filled, planes added   | Complete            |
| Cross-slice isolation      | 4 violations                    | 0 violations                   | 0 violations        |
| Feature-slice registration | 1 unregistered (`hooks/`)       | **Still unregistered**         | All registered      |

---

## 2. Verified Completions

All remediation stages confirmed complete with artifacts on disk:

| Stage           | Verdict      | Evidence                                                                                             |
| --------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| 0 — STABILIZE   | **Complete** | 36 artifacts deleted; `validate-src-purity.sh` added; build green                                    |
| 1 — GOVERNANCE  | **Complete** | ADR 0018/0005 filled; 5-plane overlay; manifest reconciled; root cleanup                             |
| 2 — MIGRATION   | **Complete** | 6 app files deleted; 20 imports switched; duplicate adapters removed                                 |
| 3 — ACL CUTOVER | **Complete** | `SendStructuredRequestPort` + `ModelLifecyclePort`; 5 call sites migrated; 3-layer enforcement       |
| 4 — FIREWALL    | **Complete** | `NoSemanticState<T>` fixed; `@hexagen/eslint-plugin-ui` created (3 rules); `firewall-blocklist.yaml` |
| 5 — MVK DRIFT   | **Complete** | `BaseDomainCommand`/`lineageId`/`timestamp` removed; drift test added                                |
| 6 — CLEANUP     | **Complete** | Brand helpers reclassified; phantom BCs downgraded; `wire.ts` exception documented                   |

---

## 3. Open Findings

### 3.1 Critical

**F-1: Cloud chat route ACL bypass (deferred Stage 3.5)**

`apps/web/app/api/llm/chat/route.ts` is a passthrough proxy. It accepts an arbitrary `apiKey` from the request body, instantiates `OpenAICompatibleAdapter` directly (line 110), and streams completions. There is no session check, no ACL gate, no governance payload, no rate limiting. Any caller with network access to this Next.js route can use it as an unauthenticated LLM proxy.

This was consciously deferred (S3.Q5) because it requires a server-context ACL design distinct from the client-side `SendStructuredRequestPort` pattern. The risk remains open.

**F-2: Unregistered hooks slice bypasses firewall (deferred AS-14)**

`apps/web/app/hooks/` contains 12 files importing from 2 kernel packages (`@hexagen/local-llm`, `@hexagen/prompt-compiler`). These imports are invisible to the firewall:

- Layer 2 (`eslint-plugin-ui`) only covers `packages/ui/**` and `apps/web/features/**`
- Layer 3 (`validate-ui-boundary.sh`) only checks `packages/ui/src/`, `apps/web/features/`, and `apps/web/app/` for specific patterns but does not enforce `allowed_hexagen_imports` on the `hooks/` directory

The hooks are the application's binding layer between kernel ports and React state. A design decision is needed on whether to formalize them as an accepted exception (like `wire.ts`) or migrate them into a registered driver slice.

### 3.2 High

**F-3: Firewall Layer 1 token drift**

Three tokens (`isPending`, `isSuccess`, `isError`) are enforced by Layer 2 (ESLint) and Layer 3 (CI script/YAML) but are **missing** from Layer 1's `ForbiddenInformationState` type and `FORBIDDEN_TOKENS` runtime array in `packages/ui/src/types/forbidden-brand.ts`. A component could accept these as props and the compile-time brand check would not catch it.

| Token       | L1 (TS Brand) | L2 (ESLint) | L3 (CI/YAML) |
| ----------- | :-----------: | :---------: | :----------: |
| `isPending` |  **missing**  |   present   |   present    |
| `isSuccess` |  **missing**  |   present   |   present    |
| `isError`   |  **missing**  |   present   |   present    |

**F-4: `emitDeclarationOnly` inconsistency (deferred AS-7)**

`tsconfig.base.json` sets `emitDeclarationOnly: false`. 12 packages override to `true`, 9 override to `false`, 6 inherit the base `false`. No clear pattern distinguishes the split. Packages like `runtime` (consumed as shared-kernel) are declaration-only, which could break if consumed outside the webpack bundler context (e.g., from `apps/tui` or `apps/api-gateway` which use different bundling).

**F-5: `tsconfig.base.json` paths + composite interaction (deferred AS-12)**

The `paths` field maps `@hexagen/*` to `packages/*/src/index.ts` for dev-time resolution. Combined with `composite: true`, this creates a fragile resolution chain that previously caused TS5055 cascades (CV-1). The `references` array in `tsconfig.base.json` only lists 12 of 27 packages. While the build is currently green, adding new cross-package references without updating both `paths` and `references` will trigger failures that are hard to diagnose.

**F-6: Validation scripts not wired into package.json**

Neither `scripts/validate-src-purity.sh` nor `scripts/validate-ui-boundary.sh` is exposed via the root `package.json` scripts section. They must be invoked manually (`bash scripts/validate-*.sh`). Without `package.json` aliases and Turbo pipeline entries, they are not part of CI and rely on developer discipline.

### 3.3 Medium

**F-7: `@hexagen/ui` subpath exports unused (deferred AS-15)**

`packages/ui/package.json` declares 6 export subpaths (`./tokens`, `./controllers`, `./elements`, `./modules`, `./sections`). Zero consumers use them. Every import resolves to the root barrel, pulling the entire UI surface. This opposes the 50 KB gzip budget (Phase 6.7).

**F-8: `@hexagen/project-generation` simplified exports**

`packages/project-generation/package.json` uses `".": "./dist/index.js"` instead of the standard `{ "types": "...", "default": "..." }` format. This omits the `types` condition, which may cause TS resolution issues for consumers under `--moduleResolution bundler`.

**F-9: ADR numbering inconsistencies**

Three ADR files have title/filename mismatches: file `0001` has title "ADR-0002", file `0002` has title "ADR-0001", file `0003` has title "ADR-0002". While non-blocking, this creates confusion when cross-referencing decisions.

**F-10: `DownloadProjectPort` is a stub**

`wire.ts:129-139` registers a `DownloadProjectPort` adapter that always returns `{ success: false, error: new Error("Not implemented") }`. This is dead functionality wired into the composition root.

**F-11: `SecretVaultPort` ephemeral + globalThis leak**

The `EphemeralSecretVaultAdapter` stores secrets in memory (lost on refresh) and is leaked to `globalThis.__hexagenVault` (wire.ts:282) as an SSR hydration workaround. This is a security surface.

**F-12: `generator.config.yaml` stale (deferred AS-13)**

Protected per AGENTS.md section 2. Predates Phase 3-5 package additions and cannot regenerate scaffolds for them. Requires `yarn sync` to update, which is event-driven only.

**F-13: ESLint plugin kernel list drift from YAML source**

The `no-kernel-imports` ESLint rule hard-codes 12 kernel packages. The `firewall-blocklist.yaml` lists 13 (including `@hexagen/agentic-interaction`). The ESLint plugin does not read from the YAML source, creating a maintenance drift vector.

---

## 4. Atomically Phased Remediation Plan

Based on the 13 findings above, organized into 5 phases with strict dependency ordering.

### Phase Dependencies

```
Phase 1 (Firewall Alignment)  --- no dependencies
Phase 2 (CI Integration)      --- no dependencies
Phase 3 (Hooks Governance)    --- depends on Phase 1 + 2
Phase 4 (Server ACL)          --- depends on Phase 3 (design decision)
Phase 5 (Build Config + Cleanup) --- no dependencies (parallel with 1-4)
```

---

### Phase 1 — FIREWALL ALIGNMENT (F-3, F-13)

**Goal:** Eliminate drift between all 3 firewall layers so every layer enforces the same set of tokens and packages.

**Rationale:** Layers 2 and 3 already catch all 11 tokens and the full kernel list. Layer 1 is 3 tokens behind. The ESLint plugin hard-codes lists instead of sharing the YAML source. These are surgical fixes.

| Unit | Deliverable                                                                      | File(s)                                                    | Scope            |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- |
| 1.1  | Add `isPending`, `isSuccess`, `isError` to `ForbiddenInformationState` type      | `packages/ui/src/types/forbidden-brand.ts`                 | L1 type guard    |
| 1.2  | Add `isPending`, `isSuccess`, `isError` to `FORBIDDEN_TOKENS` array              | `packages/ui/src/types/forbidden-brand.ts`                 | L1 runtime guard |
| 1.3  | Update `NoSemanticState` test to assert 11 entries (was 8)                       | `packages/ui/__tests__/no-semantic-state.test.ts`          | Test parity      |
| 1.4  | Update `FORBIDDEN_TOKENS` test to assert 11 entries                              | `packages/ui/__tests__/forbidden-tokens.test.ts`           | Test parity      |
| 1.5  | Add `@hexagen/agentic-interaction` to ESLint `no-kernel-imports` rule if missing | `packages/eslint-plugin-ui/src/rules/no-kernel-imports.ts` | L2 parity        |
| 1.6  | Verify all 3 layers report identical counts                                      | Manual verification                                        | Cross-layer      |

**Exit gate:** `yarn typecheck && yarn test --filter=ui && bash scripts/validate-ui-boundary.sh` — all green. Layer 1 type test asserts 11 `ForbiddenPropKeys`. All 3 layers enforce identical lists.

---

### Phase 2 — CI INTEGRATION (F-6)

**Goal:** Wire validation scripts into the build pipeline so they run automatically.

| Unit | Deliverable                                                                        | File(s)        | Scope      |
| ---- | ---------------------------------------------------------------------------------- | -------------- | ---------- |
| 2.1  | Add `"validate:purity"` script to root `package.json`                              | `package.json` | Root       |
| 2.2  | Add `"validate:boundary"` script to root `package.json`                            | `package.json` | Root       |
| 2.3  | Add `"validate"` script combining both                                             | `package.json` | Root       |
| 2.4  | Add `validate` task to `turbo.json` pipeline (depends on `^build`, `cache: false`) | `turbo.json`   | Pipeline   |
| 2.5  | Verify scripts exit non-zero on violation                                          | Manual test    | Validation |

**Exit gate:** `yarn validate` runs both scripts and returns exit code 0. Turbo runs it as part of the pipeline when invoked.

---

### Phase 3 — HOOKS GOVERNANCE (F-2)

**Goal:** Resolve the unregistered hooks slice. This requires a design decision.

**Design question (must be answered before implementation):**

The `apps/web/app/hooks/` directory is an application-layer binding between kernel ports and React state. There are two valid approaches:

**Option A — Formalize as accepted exception** (like `wire.ts`):

- Document in `layer-rules.yaml` as a `composition_root_exception`
- Add `apps/web/app/hooks/**` to the boundary script's exemption list
- Rationale: hooks ARE the application layer; they're supposed to import kernel ports

**Option B — Register as a driver slice**:

- Move `apps/web/app/hooks/local-llm/` into `apps/web/features/llm-driver/` (or similar)
- Register the slice in the manifest
- Subject it to feature-slice governance rules
- Rationale: formalizes the boundary and makes it visible to the arch-linter

| Unit | Deliverable                                                                   | File(s)                                     | Scope          |
| ---- | ----------------------------------------------------------------------------- | ------------------------------------------- | -------------- |
| 3.1  | Lock design decision (Option A or B)                                          | ADR or `layer-rules.yaml`                   | Architecture   |
| 3.2  | (If A) Add exception to `layer-rules.yaml`                                    | `.architecture/invariants/layer-rules.yaml` | Governance     |
| 3.3  | (If A) Add `hooks/` exemption to `validate-ui-boundary.sh`                    | `scripts/validate-ui-boundary.sh`           | L3 enforcement |
| 3.4  | (If B) Create `features/llm-driver/` slice                                    | `apps/web/features/llm-driver/`             | Migration      |
| 3.5  | (If B) Move hook files + update imports                                       | Multiple files                              | Migration      |
| 3.6  | (If B) Register slice in manifest                                             | `.architecture/manifest.yaml`               | Governance     |
| 3.7  | Update `firewall-blocklist.yaml` or boundary script to cover the new location | `scripts/`                                  | L3 enforcement |

**Exit gate:** `bash scripts/validate-ui-boundary.sh` passes with the hooks slice explicitly covered (either exempted or governed). No kernel import exists in ungoverned territory.

---

### Phase 4 — SERVER ACL (F-1, Stage 3.5)

**Goal:** Design and enforce ACL on the server-side cloud chat route.

This is the most architecturally complex remaining item. The client-side ACL uses `SendStructuredRequestPort` + `FreeFormStringSchema`, but the server route operates in a Node.js context where the adapter instantiation pattern differs fundamentally.

| Unit | Deliverable                                                                           | File(s)                                                       | Scope        |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------ |
| 4.1  | Author ADR 0022: Server-Context LLM ACL                                               | `.architecture/decisions/0022-server-llm-acl.md`              | Architecture |
| 4.2  | Define `ServerLLMRequestPort` (server-side equivalent of `SendStructuredRequestPort`) | `packages/local-llm/src/application/ports/in/` or new package | Domain       |
| 4.3  | Add session validation middleware to the chat route                                   | `apps/web/app/api/llm/chat/route.ts`                          | Security     |
| 4.4  | Route requests through the port (no direct adapter instantiation)                     | `apps/web/app/api/llm/chat/route.ts`                          | ACL          |
| 4.5  | Add rate limiting or governance payload validation                                    | `apps/web/app/api/llm/chat/route.ts`                          | Security     |
| 4.6  | Add integration test verifying ACL enforcement                                        | `apps/web/__tests__/` or `packages/local-llm/__tests__/`      | Test         |
| 4.7  | Extend `firewall-blocklist.yaml` with `acl_server_types` section                      | `scripts/firewall-blocklist.yaml`                             | L3           |
| 4.8  | Extend boundary script to check server routes                                         | `scripts/validate-ui-boundary.sh`                             | L3           |

**Exit gate:** The chat route no longer instantiates adapters directly. All server-side LLM requests pass through a port. The boundary script covers `apps/web/app/api/` for direct adapter imports.

---

### Phase 5 — BUILD CONFIG & CLEANUP (F-4, F-5, F-7, F-8, F-9, F-10, F-11, F-12)

**Goal:** Address remaining medium-severity items. These are independent of Phases 1-4 and can be parallelized.

#### 5.A — tsconfig normalization (F-4, F-5)

| Unit  | Deliverable                                                                             | File(s)                     | Scope    |
| ----- | --------------------------------------------------------------------------------------- | --------------------------- | -------- |
| 5.A.1 | Audit and document which packages need `emitDeclarationOnly: true` vs `false`           | ADR or doc                  | Analysis |
| 5.A.2 | Normalize: set all packages consumed via bundler to `true`, all standalone to `false`   | Per-package `tsconfig.json` | Build    |
| 5.A.3 | Ensure `tsconfig.base.json` `references` lists all 27 packages                          | `tsconfig.base.json`        | Build    |
| 5.A.4 | Verify clean CI build (`rm -rf packages/*/dist .turbo && yarn build && yarn typecheck`) | Validation                  | Build    |

#### 5.B — Package hygiene (F-7, F-8)

| Unit  | Deliverable                                                                                 | File(s)                                    | Scope   |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------------ | ------- |
| 5.B.1 | Fix `@hexagen/project-generation` exports to standard format                                | `packages/project-generation/package.json` | Package |
| 5.B.2 | Either codemod `@hexagen/ui` consumers to use subpath imports or remove the subpath exports | `packages/ui/package.json` + consumers     | Bundle  |
| 5.B.3 | Measure bundle size impact of subpath imports vs root barrel                                | Validation                                 | Bundle  |

#### 5.C — Documentation & minor fixes (F-9, F-10, F-11)

| Unit  | Deliverable                                                              | File(s)                    | Scope      |
| ----- | ------------------------------------------------------------------------ | -------------------------- | ---------- |
| 5.C.1 | Fix ADR title/filename mismatches (0001, 0002, 0003)                     | `.architecture/decisions/` | Governance |
| 5.C.2 | Either implement `DownloadProjectPort` or remove the stub from `wire.ts` | `apps/web/app/lib/wire.ts` | Hygiene    |
| 5.C.3 | Replace `globalThis.__hexagenVault` leak with proper SSR-safe injection  | `apps/web/app/lib/wire.ts` | Security   |

**Exit gate:** `yarn build && yarn typecheck && yarn lint && yarn lint:arch` green on clean workspace. All ADR titles match filenames. No `globalThis` leaks in `wire.ts`.

---

## 5. Priority Matrix

| Phase                      | Findings             | Severity | Effort                                | Recommended Timeline |
| -------------------------- | -------------------- | -------- | ------------------------------------- | -------------------- |
| 1 — Firewall Alignment     | F-3, F-13            | High     | S (1-2 hours)                         | Immediate            |
| 2 — CI Integration         | F-6                  | High     | S (1 hour)                            | Immediate            |
| 3 — Hooks Governance       | F-2                  | Critical | M (half day, pending design decision) | This sprint          |
| 4 — Server ACL             | F-1                  | Critical | L (1-2 days, new ADR required)        | This sprint          |
| 5 — Build Config & Cleanup | F-4,5,7,8,9,10,11,12 | Medium   | L (2-3 days, mostly independent)      | Next sprint          |

---

## 6. Items Explicitly Out of Scope

| Item                                | Reason                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| AS-13 (`generator.config.yaml`)     | Protected per AGENTS.md section 2; requires `yarn sync` event                                   |
| Phase 3-7 execution plan completion | Phases 3-7 are in-flight per the existing plan; this report addresses deferred remediation only |
| New feature development             | Blocked until at least Phases 1-3 of this plan land                                             |

---

_End of report. Review conducted in read-only mode; no production files were modified. This document is the authorized record of post-remediation findings._
