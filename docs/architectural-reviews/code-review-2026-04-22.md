# HexaGen Monaco — Code Review & Remediation Plan

| Field    | Value                                                               |
| -------- | ------------------------------------------------------------------- |
| Date     | 2026-04-22                                                          |
| Mode     | Review & Archeology (read-only) → Develop (save-to-docs only)       |
| Reviewer | Architectural co-pilot (OpenCode)                                   |
| Scope    | Repository-wide audit of claimed state vs. actual state             |
| Verdict  | Build is broken; several critical invariants unenforced; plan drift |

## Executive Summary

Two planning/audit artifacts were submitted for review:

- **Batch 1** — _Final Declarative Architectural Plan_ (Phases 0–6), status "Ready for Execution (pending Q13 + plan-mode exit authorization)".
- **Batch 2** — _Architectural Audit Report_ scoring the system 8.5/10 with "None detected" for critical violations.

Both artifacts materially misrepresent the repository's real state. The codebase is a **mid-Phase-7 migration on top of a broken Stage-0 build**. The architectural goals (three-plane topology, contracts-first, 3-layer information-state firewall, LLM ACL) are present at the folder-structure level but their enforcement surface is too weak to hold the invariants under normal developer pressure.

This document records:

1. What the repository actually contains (ground truth from `git log`, filesystem, build output).
2. **Critical violations** that block further development.
3. **Architectural smells** that require attention but not blocking.
4. A **six-stage remediation plan** with decisions locked by the reviewer.

---

## Table of Contents

- [Ground Truth](#ground-truth)
- [Part A — Critical Violations (CV-1 … CV-7)](#part-a--critical-violations)
- [Part B — Architectural Smells (AS-1 … AS-17)](#part-b--architectural-smells)
- [Part C — Severity Summary Table](#part-c--severity-summary-table)
- [Part D — Remediation Plan (initial groups)](#part-d--remediation-plan-initial-groups)
- [Part E — What Should NOT Be Preserved from Batch 1 / Batch 2](#part-e--what-should-not-be-preserved-from-batch-1--batch-2)
- [Part F — Decision Registry (Locked)](#part-f--decision-registry-locked)
- [Part G — Finalized Remediation Plan (Six Stages)](#part-g--finalized-remediation-plan-six-stages)
- [Part H — Stage 0 Ready-to-Go Atomic Units](#part-h--stage-0-ready-to-go-atomic-units)
- [Part I — Summary](#part-i--summary)
- [Appendix A — Evidence: `git log`](#appendix-a--evidence-git-log)
- [Appendix B — Evidence: file counts & build output](#appendix-b--evidence-file-counts--build-output)

---

## Ground Truth

From `git log` (most recent relevant commits on `main`):

| Commit    | Subject                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `457c28f` | `refactor(Phase 7): migrate grounded-prompt to prompt-compiler` — Phase 7 **in flight**               |
| `4a4da57` | `test(Phase 6): add property-based tests for domain invariants`                                       |
| `510070d` | `feat(prompt-compiler,local-llm,reconciliation-engine): complete Phase 5 — probabilistic layer`       |
| `797646b` | `feat(transaction-system): complete Phase 4 — transaction lifecycle, speculative state, backpressure` |
| `d16886f` | `refactor(intent-compiler): complete Phase 3.A DDD restructure`                                       |
| `c4c13d1` | `feat: add Phase 4-6 packages`                                                                        |
| `a1954e7` | `refactor(web): complete Phase 1.7 — consolidate app/ composition root`                               |
| `7393112` | `feat: migrate app/components to feature folders + @hexagen/ui sections/modules`                      |
| `08b67e6` | `feat(ui): scaffold Phase 1 projection kernel isolation`                                              |
| `5e3e47f` | `chore: complete Phase 0 MVK compilation pass (atomic units 0.0-5.0)`                                 |
| `a8edecb` | `chore: gitignore .js build artifacts in packages/*/src/`                                             |

On disk: 28 packages including every "NEW" package Batch 1 claims is pending (`core-domain`, `ui`, `intent-compiler`, `layout-engine`, `ui-projection-compiler`, `transaction-system`, `reconciliation-engine`, `prompt-compiler`, `runtime`), 22 ADRs (0000–0021), `.architecture/mvk/{spec,drift-report}-v1.md`, `.architecture/plans/phase-3-7-execution-plan-v1.md` (787 lines).

**Conclusion**: Batch 1's claim _"⏸ Execution blocked — awaiting Q13 + authorization"_ is factually inaccurate. Execution has happened; Phase 7 is in progress.

---

## Part A — Critical Violations

### CV-1 · The build is broken

```
yarn typecheck
@hexagen/local-llm:typecheck: src/application/use-cases/recommend-model.use-case.ts(3,15):
  error TS2305: Module '"@hexagen/local-llm"' has no exported member 'ModelDescriptor'.
@hexagen/local-llm:typecheck: src/domain/model-catalog.ts(50,14):
  error TS1361: 'DomainModelId' cannot be used as a value because it was imported using 'import type'.
  [… 7 occurrences total …]
 Failed: @hexagen/local-llm#typecheck
```

```
yarn lint (triggers build via turbo pipeline)
@hexagen/local-llm:build: error TS5055: Cannot write file '…/dist/…/*.d.ts' because it would
overwrite input file.  [… 31 occurrences …]
 Failed: @hexagen/local-llm#build
```

Root causes:

- `packages/local-llm/src/domain/model-catalog.ts:1` uses `import type { DomainModelId }` but the symbol is used as a **value** (enum member access) on lines 50, 63, 76, 90, 103, 117, 130.
- `packages/local-llm/src/application/use-cases/recommend-model.use-case.ts:3` imports `ModelDescriptor` from `@hexagen/local-llm` (**self-package / circular**) rather than from the local domain path.
- **TS5055** cascade: stale `dist/**/*.d.ts` is picked up as input on incremental build (see also CV-2 for the mechanism).

**Impact**: AGENTS.md §1 mandates _"Before starting ANY work: `yarn build && yarn typecheck && yarn lint` — If any command fails, STOP."_ New development is blocked. Batch 2's "production-ready" claim is untenable.

**References**: `packages/local-llm/src/domain/model-catalog.ts:1`, `packages/local-llm/src/domain/model-catalog.ts:50`, `packages/local-llm/src/application/use-cases/recommend-model.use-case.ts:3`.

---

### CV-2 · `.d.ts` and `.js` files in `src/` directories

```
packages/core-domain/src/index.d.ts
packages/core-domain/src/index.js
packages/core-domain/src/mvk/v1/*.d.ts        (11 files)
packages/core-domain/src/mvk/v1/*.d.ts.map    (11 files)
packages/core-domain/src/mvk/v1/*.js          (11 files)
```

AGENTS.md §2 _"Files Never Edit"_ and §4 _"Architectural Constraints"_:

> `**/src/**/*.d.ts` — Build artifacts — should not exist in `src/`.
> `.d.ts` files in `src/` directories — Build artifacts must only exist in `dist/`.

Commit `a8edecb "chore: gitignore .js build artifacts in packages/*/src/"` shows the issue is known; the fix was to _hide_ the symptom in git rather than remove the files from the working tree. They remain on disk and are picked up by `include: ["src/**/*"]`, driving the TS5055 cascade in CV-1.

**References**: `packages/core-domain/src/mvk/v1/` (36 artifact files), `packages/core-domain/tsconfig.json:11`.

---

### CV-3 · Cross-feature-slice imports (violates Q4 / Plan Part III.4)

Batch 1 Part III.4 rule:

> A feature slice may import from `@hexagen/ui`, `@hexagen/core-domain`, `@hexagen/shared`, and its own siblings. It **may NOT** import from other feature slices.

Actual violations:

| File                                                                                            | Forbidden import                        |
| ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| `apps/web/features/workspace-shell/hooks/useManifestImport.ts:5`                                | `from "../../project-wizard/config"`    |
| `apps/web/features/workspace-shell/hooks/useWizardForm.ts:17`                                   | `from "../../project-wizard/config"`    |
| `apps/web/features/workspace-shell/hooks/useProjectLifecycle.ts:7`                              | `from "../../project-wizard/config"`    |
| `apps/web/features/governance-assistant/hooks/governance-assistant/derive-governance-keys.ts:8` | `from "../../../project-wizard/config"` |

Batch 2's KPI _"Feature slice isolation — 0 cross-slice imports"_ and its _"9/10 Boundary Integrity"_ score are contradicted. The on-disk plan (`phase-3-7-execution-plan-v1.md` Part XI.2 AR-10) already anticipates this risk — it has already materialized.

---

### CV-4 · LLM ACL is declared but unenforced at the composition root

ADR 0021 (Accepted, 119 lines):

> _"LLM inputs are guaranteed to pass through prompt-compiler's schema generation (ACL enforcement)."_
> _"Breaking change for any code that directly constructs `LLMMessage[]` — must migrate to `SendStructuredRequestPort`."_

Actual:

- `apps/web/app/lib/wire.ts:35,48` wires `WebLLMAdapter` directly via `LocalLLMProviderPort` — never touches `prompt-compiler` or `SendStructuredRequestPort`.
- **42 direct imports from `@hexagen/local-llm`** across `apps/web/`.
- **12+ direct `LLMMessage[]` construction sites** bypassing the compiled-prompt pipeline:
  - `apps/web/app/hooks/local-llm/useChatMessages.ts:196,238`
  - `apps/web/features/governance-assistant/hooks/governance-assistant/useGovernanceQuestionActions.ts:30,37,165`
  - `apps/web/features/governance-assistant/hooks/governance-assistant/useGovernanceThread.ts:23,83,111,172`

The port and `implements SendStructuredRequestPort` exist (`packages/local-llm/src/application/ports/in/send-structured-request.port.ts`, `packages/local-llm/src/infrastructure/adapters/webllm.adapter.ts:66`) but are **never called from the web driver**. Batch 2's claim _"LLM outputs are validated against Zod schemas at 100% rate"_ is not testable because inputs are uncompiled; response-side schema validation alone cannot enforce the invariant.

This is AR-8 from the on-disk plan (Critical severity), manifested in a worse form than predicted: adapters receive raw UI-constructed `LLMMessage[]`, not RRP.

---

### CV-5 · The 3-layer information-state firewall is structurally defective

**Layer 1 (TS brand) — `packages/ui/src/types/forbidden-brand.ts`**:

```ts
export type NoSemanticState<T> = T & __HexagenSemanticState;
```

where `__HexagenSemanticState = { readonly [sym]?: never }`.

An intersection with `{ sym?: never }` **adds nothing to `T`'s assignability** w.r.t. forbidden keys: `<Button loading data="x" error />` still typechecks. The correctly-typed helper `AllowedProps<T>` in the _same file_ (lines 57–59) would subtract `ForbiddenPropKeys` from `T`, but it is **not used anywhere**.

**Layer 2 (ESLint) — `packages/ui/eslint.config.mjs`**:

- Only enforces `no-restricted-imports` (i.e., **Q5c imports only**).
- Does **not** enforce Q5a (prop names), Q5b (`useState` names), or JSX attribute blocks.
- The plan's mandated custom plugin `@hexagen/eslint-plugin-ui` with rules `hexagen-ui/no-information-state`, `hexagen-ui/no-kernel-imports`, `hexagen-ui/no-feature-slice-imports` **does not exist**.
- Restriction list missing: `@hexagen/ui-projection-compiler`, `@hexagen/layout-engine`, `@hexagen/runtime`, `@hexagen/mcp-server`.

**Layer 3 (CI) — `scripts/validate-ui-boundary.sh`**:

- Check 3 (semantic-state tokens) is **warning-only** and never increments `VIOLATIONS` (see lines 65–66 `# Warning only`).
- `KERNEL_PKGS` list (lines 25–33) is missing `@hexagen/ui-projection-compiler`, `@hexagen/layout-engine`, `@hexagen/local-llm`, `@hexagen/agentic-interaction`, `@hexagen/mcp-server`.
- Not symmetric with `packages/ui/eslint.config.mjs` restriction list — each layer has a different blacklist.

**Feature-slice consequence**:

- `apps/web/features/hexagon-canvas/BoundedContext.tsx:11,12` imports `VisualVariant`, `VisualVariantCategory`, `CvaVariantResolverAdapter` from `@hexagen/ui-projection-compiler` — a kernel-plane package. Feature slices are importing kernel adapters directly.

All three layers pass (`./scripts/validate-ui-boundary.sh` literally prints `✅ PASSED`) but enforce essentially nothing of substance.

**References**: `packages/ui/src/types/forbidden-brand.ts:1-59`, `packages/ui/eslint.config.mjs:39-67`, `scripts/validate-ui-boundary.sh:25-66`.

---

### CV-6 · ADR 0018 is a bullet-point stub while ADR 0019–0021 depend on it

`.architecture/decisions/0018-mvk-semantic-kernel-contracts.md` — 53 lines, all headers with 1-line bullets:

```
## Decision
- Locked Q1–Q13 decisions enumerated
- Compilation pass atomicity
- Three-plane topology with convergence roadmap
## Rationale
- Controller hybrid (Q1)
- Three-layer firewall (Q2/Q5)
- ...
```

Status line (line 3): `**Status:** Draft`.

But `0019:5` = `Accepted`, `0020:5` = `Accepted`, `0021:5` = `Accepted`. All three cite ADR 0018 as their foundation.

Batch 1 Phase 0 Exit Gate: _"ADR 0018 finalized with frontmatter pointing to drift + spec"_ — **not met**.

Additionally, `.architecture/decisions/0005-shared-kernel-type-migration.md` is **0 bytes**, yet ADR 0018 line 6 declares _"Supersedes: None (extends ADR-0005 shared kernel framing)"_. ADR 0018 extends an empty document.

---

### CV-7 · Spec vs. TypeScript drift within the MVK compilation pass

`.architecture/mvk/spec-v1.md` (lines 166–215) specifies `DomainCommand` variants with payload only:

```
type DomainCommand =
  | { type: "CreateNode"; payload: { kind, attributes } }
  | { type: "UpdateNode"; payload: { nodeId, attributes } }
  | ...
```

`packages/core-domain/src/mvk/v1/domain-command.ts:15-109` implements:

```ts
interface BaseDomainCommand {
  readonly lineageId: Identifier;
  readonly timestamp: number;
}
export interface CreateNodeCommand extends BaseDomainCommand {
  type: "CreateNode";
  payload: { kind; attributes };
}
```

Every variant inherits `lineageId` and `timestamp` — **not in the spec**. Spec §Authority Model (line 37–40):

> _"MVK Spec = Canonical (human truth), TypeScript = Structural Validator (machine enforcement of contract shape)."_

A structural validator that adds fields the canonical source does not declare is not validating; it is diverging. Since intent lineage is carried by the separate `IntentLineage` shape (spec line 333–365), the command-level `lineageId` **duplicates** that concern.

Intra-Phase-0 drift is the exact failure mode Phase 0 was created to prevent.

---

## Part B — Architectural Smells

### AS-1 · Duplicate / zombie adapters in `packages/prompt-compiler/src/infrastructure/adapters/`

```
grounded-prompt-builder.adapter.ts         + migrated-grounded-prompt.adapter.ts
wizard-context-serializer.adapter.ts       + migrated-wizard-context-serializer.adapter.ts
app-compatibility.adapter.ts               (purpose unclear)
```

Both pairs implement `BuildSystemInstructionPort` / context serialization with different interface signatures (`diff` shows `request: { name; domainAST; governanceRules; templateOverrides? }` vs. `request: BuildSystemInstructionRequest`). A composition root choosing the wrong one silently changes LLM prompt shape.

### AS-2 · Phase 7 migration presented as complete is mid-flight

`apps/web/app/lib/` contents (14 files; items in **bold** are explicit ADR-0021 / Phase-7 migration targets still residing at source):

```
compose-wizard-data.ts         (→ wizard-orchestration, Phase 7)
download-blob.ts               (stays)
fetch-json.ts                  (stays)
governance-question-templates.ts  (→ prompt-compiler, Phase 5)  ← copy already in packages
grounded-prompt.ts             (→ prompt-compiler, Phase 5)     ← copy already in packages
language-utils.ts              (stays)
model-recommendation.ts        (→ local-llm, Phase 5)           ← copy already in packages
persisted-state.ts             (stays)
tree-utils.ts                  (stays)
utils.ts                       (stays)
wire.project-generation.ts     (stays — composition root)
wire.ts                        (stays — composition root)
wizard-assistant-context.ts    (→ prompt-compiler, Phase 5)     ← copy already in packages
wizard-to-manifest.ts          (→ wizard-orchestration, Phase 7)
```

`apps/web/app/config/` still contains `models.ts` and `cloud-providers.ts`. Phase 7 exit gate requires `config/` deleted.

### AS-3 · Manifest dual-truth with filesystem

| Manifest says                                                                | Filesystem says                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `runtime` has empty entities / VOs / use_cases / ports / adapters            | `runtime/src/` has 6 TS files (guards + generator)                     |
| `ui` has 3 value objects, no other layers                                    | `ui/src/` has elements/, modules/, sections/, controllers/, tokens/    |
| `runtime` declared `type: shared-kernel`                                     | `layer-rules.yaml shared_kernels:` lists only `shared` + `core-domain` |
| `architectural-enforcement` & `code-generation` typed `core`                 | `src/` is four empty `index.ts` barrels                                |
| No `planes:` overlay section (Q7 mandate)                                    | Plan Phase 0 atomic unit 4.0 requires it                               |
| `intent-compiler depends_on runtime`                                         | `runtime` is not a registered shared kernel                            |
| No mention of `features/*` slice structure                                   | `apps/web/features/` has 7 slices                                      |
| No mention of `apps/web/app/{contexts,hooks,providers,architecture-viewer}/` | All exist                                                              |

`yarn lint:arch` prints _"✅ Architecture is compliant with manifest.yaml"_ — but the linter reads the manifest; it does not read the ground truth. All the above evade it.

### AS-4 · Three contradictory planning documents

1. **Batch 1**: Phase 0 pending, all packages "to create", awaiting Q13.
2. **`.architecture/plans/phase-3-7-execution-plan-v1.md`** (787 lines, on disk): Phase 0 + 1 ✅ complete; Phases 3–7 pending.
3. **Batch 2** (audit): all phases complete; 8.5/10 production-ready.

Each contradicts the others; none matches `git log` + filesystem + build output.

### AS-5 · Root-directory clutter

```
MANIFEST_AUTOMATION_ARCHITECTURE.md   12 562 bytes
MANIFEST_AUTOMATION_INDEX.md           8 055 bytes
MANIFEST_AUTOMATION_REPORT.md         24 122 bytes
MANIFEST_AUTOMATION_SUMMARY.md         3 627 bytes
SYNC-MIGRATION-REPORT.md                  25 bytes (stub)
files.log                             20 073 bytes
trace.log                            746 586 bytes
```

None are referenced in manifest, plan, or any ADR. Location conflicts with AGENTS.md §2 (protected root files).

### AS-6 · `ui` manifest-declared value objects are brand helpers, not DDD VOs

```yaml
- name: ui
  layers:
    domain:
      value_objects:
        - InformationStateBrand
        - ForbiddenToken
        - InteractionStateOnly
```

These are compile-time TS brand helpers with no semantics of their own. Recording them as "value objects" inflates `arch-lint`'s compliance signal.

### AS-7 · `emitDeclarationOnly` inconsistency across packages

- `tsconfig.base.json`: `emitDeclarationOnly: true`.
- `packages/core-domain/tsconfig.json`: inherits (effectively true).
- But `packages/core-domain/src/` contains `.js` files (not just `.d.ts`) — indicates a divergent earlier emission or a manual process.

### AS-8 · `wire.ts` composition root is kernel-aware

`wire.ts:16-52` imports types from six kernel packages and instantiates adapters directly. Phase 7 plan Part XI.2 AR-9 flags this as accepted ("Medium"). Batch 1 and Batch 2 never mention this exception.

### AS-9 · Manifest `no-restricted-imports` is inert

Root manifest (lines 21–25) forbids all `@hexagen/*` cross-imports, then `linter-config.yaml` per-package `allowed_imports` relaxes this. Only the per-package list fires. Duplication invites drift.

### AS-10 · Phantom bounded contexts

`packages/architectural-enforcement/` and `packages/code-generation/` each have four empty barrel `index.ts` files, yet are declared `type: core` in the manifest. Empty package as bounded context is pure overhead.

### AS-11 · No `planes:` overlay despite Q7 "Locked"

`grep -n "planes:" .architecture/manifest.yaml` returns no matches. Manifest still uses `type: core | supporting | shared-kernel | driver` — the pre-Q7 taxonomy. Plane assignment must be inferred from ADR 0019/0021 prose + `layer-rules.yaml` + `depends_on` graph.

### AS-12 · `tsconfig.base.json` paths → `src/index.ts` combined with composite + emitDeclarationOnly

`paths: "@hexagen/*": ["packages/*/src/index.ts"]` is the bundler resolution pattern (per AGENTS.md Appendix). Combined with `composite: true` across all packages + leaked `.d.ts` in `src/` (CV-2), this creates the TS5055 cascade.

### AS-13 · Stale `generator.config.yaml` ownership registry

`MANIFEST_AUTOMATION_SUMMARY.md` confirms: _"Ownership Registry: Manual (aspirational auto-update missing)."_ `generator.config.yaml` predates the Phase 3–5 package additions and cannot regenerate scaffolds for them. AGENTS.md §2 forbids hand-edits.

### AS-14 · `apps/web/app/hooks/**` is a de-facto unregistered slice

5 292-byte `useLocalLlm.tsx` plus an 8-file `local-llm/` subtree — cross-feature hooks that import `@hexagen/local-llm` directly, governed by no invariant check.

### AS-15 · `@hexagen/ui` subpath exports present but unused

`packages/ui/package.json:7-32` declares `./tokens`, `./controllers`, `./elements`, `./modules`, `./sections`. Every observed import uses the root barrel, pulling the full UI surface. Fights the 50 KB gzip budget (Batch 1 IX.1).

### AS-16 · `packages/ui/__tests__/` is empty

The test shell exists; the tests do not. Other new packages have tests (property-based for `transaction-system`, `layout-engine`, `core-domain`).

### AS-17 · Batch 2 audit is internally inconsistent

Batch 2 simultaneously claims _"Critical Violations: None detected"_, _"Overall 8.5/10 production-ready"_, and lists five migration tasks as "Immediate Fixes (1-3 Days)". Those are the Phase 7 / ADR-0021 migrations — i.e., declared invariant violations that haven't been resolved.

Additionally Batch 2's _"No Unnecessary Abstractions Detected"_ + _"All layers serve clear, distinct purposes"_ contradicts the duplicate adapters (AS-1), phantom bounded contexts (AS-10), and empty `infrastructure/` barrel under `packages/runtime/src/infrastructure/index.ts`.

---

## Part C — Severity Summary Table

| ID    | Finding                                                   | Severity    | Blocks dev?        |
| ----- | --------------------------------------------------------- | ----------- | ------------------ |
| CV-1  | Broken build (`local-llm` typecheck + TS5055 cascade)     | Critical    | Yes — AGENTS.md §1 |
| CV-2  | `.d.ts`/`.js` in `src/` (36+ files in core-domain)        | Critical    | Yes — drives CV-1  |
| CV-3  | Cross-feature-slice imports (4 confirmed)                 | Critical    | Policy             |
| CV-4  | LLM ACL declared but unenforced (42 bypass sites)         | Critical    | Invariant          |
| CV-5  | 3-layer firewall structurally defective at all 3 layers   | Critical    | Invariant          |
| CV-6  | ADR 0018 stub; ADR 0005 empty; 0019–0021 build on vapor   | High        | Governance         |
| CV-7  | MVK spec↔TS drift (`DomainCommand` lineageId/timestamp)   | High        | Invariant          |
| AS-1  | Duplicate adapters in `prompt-compiler`                   | High        | Quality            |
| AS-2  | Phase 7 migration half-done (14 lib files)                | High        | Quality            |
| AS-3  | Manifest ≠ filesystem in 8 places                         | High        | Governance         |
| AS-4  | 3 contradictory planning documents                        | High        | Coherence          |
| AS-5  | 4+ undocumented root MD/log files                         | Medium      | Hygiene            |
| AS-6  | `ui` manifest value objects are brand helpers             | Medium      | Governance         |
| AS-7  | `emitDeclarationOnly` inconsistency across packages       | Medium      | Build              |
| AS-8  | `wire.ts` composition root is kernel-aware                | Medium (OK) | —                  |
| AS-9  | Manifest-level `no-restricted-imports` inert              | Low         | Hygiene            |
| AS-10 | Phantom bounded contexts (arch-enf, code-gen)             | Medium      | Governance         |
| AS-11 | No `planes:` overlay in manifest                          | High        | Governance         |
| AS-12 | Paths→src + composite interaction causing TS5055          | High        | Build              |
| AS-13 | Stale `generator.config.yaml` ownership                   | High        | Tooling            |
| AS-14 | `apps/web/app/hooks/**` de-facto slice without governance | High        | Boundary           |
| AS-15 | Subpath exports unused by consumers                       | Medium      | Bundle             |
| AS-16 | `packages/ui/__tests__/` empty                            | Medium      | Quality            |
| AS-17 | Batch 2 audit internally inconsistent                     | Medium      | Governance         |

---

## Part D — Remediation Plan (Initial Groups)

Grouped into **Stabilize → Consolidate → Harden → Align**. Each group is an independent work unit.

### Group 1 — Stabilize the build (unblocks everything)

Target: `yarn build && yarn typecheck && yarn lint && yarn lint:arch` green on a clean tree.

1. **Remove `src`-embedded build artifacts** (fixes CV-2, AS-7, AS-12)
   - Delete `packages/core-domain/src/**/*.{d.ts,d.ts.map,js}` (36 files).
   - Sweep: `find packages -path "*/src/*" \( -name "*.d.ts" -o -name "*.js" \) | grep -v node_modules`.
   - Add an `outDir` materialization guard comment in `tsconfig.base.json`: _"Only `.ts/.tsx` may live under `src/`."_
2. **Fix `local-llm` typecheck errors** (fixes CV-1)
   - `packages/local-llm/src/domain/model-catalog.ts:1` — change `import type` → `import` (enum member is a runtime value).
   - `packages/local-llm/src/application/use-cases/recommend-model.use-case.ts:3` — replace `@hexagen/local-llm` self-import with a relative path.
3. **Clean `dist/` across all packages before a full `yarn build`** (fixes TS5055)
   - `rm -rf packages/*/dist .turbo && find . -name "*.tsbuildinfo" -delete` then `yarn build`.
4. **Add CI guard** — `scripts/validate-src-purity.sh` fails if any `packages/*/src/**/*.{d.ts,js}` exists.

**Exit gate for Group 1**: All four commands green on a cleaned workspace.

### Group 2 — Close the migration (AS-1, AS-2)

5. **Consolidate duplicate adapters in `prompt-compiler`** (AS-1).
6. **Finish `app/lib` → package migrations** (AS-2) per ADR-0021.
7. **Run codemods for consumer imports** (`@/app/lib/*` → `@hexagen/<package>/...`, `@/app/config/*` → `@hexagen/local-llm/...`).

**Exit gate**: Zero `@/app/lib/*` and `@/app/config/*` imports outside composition-root files. `apps/web/app/config/` deleted.

### Group 3 — Close the ACL (CV-4)

8. Establish ACL gate at composition root (expose only `SendStructuredRequestPort`).
9. Migrate 12+ call sites from `LLMMessage[]` to `PromptTemplate + StructuredOutputSchema`.
10. Add compile-time ACL enforcement via restricted imports.

**Exit gate**: `grep -rn "LLMMessage\[\]" apps/web` → 0. Only `wire.ts` imports `@hexagen/local-llm`.

### Group 4 — Harden the information-state firewall (CV-5)

11. Repair Layer 1 (`NoSemanticState<T> = AllowedProps<T>`), add type-test fixture.
12. Build Layer 2 ESLint plugin `@hexagen/eslint-plugin-ui` with the three prescribed rules, applied to `ui/**` AND `features/**`.
13. Repair Layer 3 shell script (increment on match; single source `firewall-blocklist.yaml` shared with Layer 2).

**Exit gate**: Red-path fixtures fail at all three layers; cross-slice imports removed.

### Group 5 — Restore governance integrity (CV-6, AS-3, AS-4, AS-11)

14. Finalize ADR 0018 (Draft → Accepted, full content).
15. Add `planes:` overlay to `.architecture/manifest.yaml` (Q7).
16. Reconcile manifest ↔ filesystem.
17. Resolve documentation-truth inconsistency — retain on-disk plan as canonical, retract Batch 1 & Batch 2.
18. Triage root-level MD/log files.

**Exit gate**: `yarn lint:arch` enforces plane direction; all 22 ADRs have non-empty content; manifest matches filesystem truth.

### Group 6 — Align the MVK spec & code (CV-7)

19. Remove `BaseDomainCommand` + `lineageId` + `timestamp` from `DomainCommand` (keep on `IntentLineage`). Emit compilation pass `cp-2026-04-22-01`.
20. Add machine-enforced spec↔TS drift test.

**Exit gate**: `domain-command.ts` and `spec-v1.md §DomainCommand` are shape-equivalent.

### Group 7 — Cleanups (AS-6, AS-8, AS-9, AS-10, AS-13, AS-15, AS-16) ✅ COMPLETED 2026-04-22

AS-6 ui manifest cleanup: moved brand helpers from value_objects → types
AS-8 Documented wire.ts composition-root exception in layer-rules.yaml
AS-9 Dropped inert root manifest no-restricted-imports (superseded by linter-config.yaml)
AS-10 Downgraded phantom BCs (architectural-enforcement, code-generation) from type: core → supporting + status: scaffold
AS-13 Skipped — generator.config.yaml is protected per AGENTS.md §2
AS-15 Skipped — subpath codemod deferred (no consumers yet)
AS-16 Filled packages/ui/**tests**/ with no-semantic-state.test.ts + forbidden-tokens.test.ts

---

## Part E — What Should NOT Be Preserved from Batch 1 / Batch 2

The following claims must **not** survive into any committed document:

- Batch 1: _"Phase 0 PENDING"_, _"⏸ Execution blocked — awaiting Q13 + authorization"_ — Phases 0–5 are complete; Phase 7 is in progress.
- Batch 1: _"SCOPE-1 pending — package classification for project-configuration / project-generation / code-generation"_ — drift report already ruled "Not applicable".
- Batch 2: _"8.5/10 production-ready"_ — build fails.
- Batch 2: _"Critical Violations: None detected"_ — seven confirmed.
- Batch 2: _"Feature slice isolation — 0 cross-slice imports"_ — four confirmed.
- Batch 2: _"LLM outputs validated against Zod schemas at 100% rate"_ — input-side ACL bypassed.
- Batch 2: _"3-layer firewall working as designed"_ — all three layers have holes.

Batch 1's decision registry Q1–Q12 remains useful as recorded policy; Q13 is closed by the fact that co-emission occurred in commits `5e3e47f` + `2cb27f4`.

---

## Part F — Decision Registry (Locked)

Reviewer-confirmed decisions during this audit:

| #   | Decision                            | Value                                                                                                                       |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| D1  | Canonical plan                      | `.architecture/plans/phase-3-7-execution-plan-v1.md` (updated). Retire Batch 1 & Batch 2 as conversation-only.              |
| D2  | MVK `DomainCommand` drift direction | Remove `lineageId` + `timestamp` from `DomainCommand`; keep them on `IntentLineage`. Emit new compilation pass.             |
| D3  | ACL cutover                         | Hard cutover: remove `LLMMessage` from `@hexagen/local-llm` public exports this sprint; break bypass call sites.            |
| D4  | Firewall scope                      | `hexagen-ui/*` rules apply to `packages/ui/**` **and** `apps/web/features/**`.                                              |
| D5  | Root-level artifacts                | Move `MANIFEST_AUTOMATION_*.md` → `docs/manifest-automation/`; delete `files.log`, `trace.log`, `SYNC-MIGRATION-REPORT.md`. |

---

## Part G — Finalized Remediation Plan (Six Stages)

```
Stage 0 — STABILIZE (blocks everything)
  S0.1  Delete src-embedded .d.ts / .js / .d.ts.map
         (packages/core-domain/src/** sweep + repo-wide check)
  S0.2  Fix @hexagen/local-llm typecheck:
         - model-catalog.ts line 1: import type → import
         - recommend-model.use-case.ts line 3: replace self-import with relative
  S0.3  Clean dist/ + .turbo + *.tsbuildinfo once
  S0.4  Add scripts/validate-src-purity.sh (not CI-gated yet)
  Gate: yarn build && yarn typecheck && yarn lint && yarn lint:arch all green

Stage 1 — GOVERNANCE REALIGNMENT (parallel with Stage 2)
  G1.1  Finalize ADR 0018 (Draft → Accepted, full content, frontmatter)
  G1.2  Fill or retire ADR 0005
  G1.3  Add planes: overlay to manifest.yaml
         kernel:         core-domain, intent-compiler, layout-engine,
                         ui-projection-compiler, transaction-system,
                         prompt-compiler, architectural-enforcement,
                         wizard-orchestration, monaco-orchestration
         projection:     ui, visualization, web-driver
         probabilistic:  local-llm, agentic-interaction,
                         reconciliation-engine, mcp-server
         infrastructure: persistence, messaging, external-integration,
                         deployment, sync, runtime
         shared-kernel:  shared, core-domain
  G1.4  Reconcile manifest ↔ filesystem
         - runtime: list guards/generators; register in layer-rules.shared_kernels
         - ui: model elements/modules/sections/controllers/tokens
         - architectural-enforcement, code-generation: implement or delete
         - Decide fate of apps/web/app/{hooks,contexts,providers,architecture-viewer}
  G1.5  Update phase-3-7-execution-plan-v1.md Part I.2:
         - Phase 5 ✅ Complete (commit 510070d)
         - Phase 6 🟡 In flight (commit 4a4da57)
         - Phase 7 🟡 In flight (commit 457c28f)
  G1.6  Do NOT commit Batch 1 / Batch 2 artifacts to .architecture/
  G1.7  Root cleanup per D5
  Gate: yarn lint:arch enforces plane direction; all 22 ADRs have non-empty
        content and accurate status; every manifest bounded_context matches
        filesystem truth

Stage 2 — CLOSE MIGRATION (AS-1, AS-2)
  M2.1  Resolve prompt-compiler duplicate adapters
  M2.2  Migrate remaining app/lib files
         - grounded-prompt.ts, governance-question-templates.ts,
           wizard-assistant-context.ts → delete (package versions canonical)
         - model-recommendation.ts → @hexagen/local-llm/application/use-cases/
         - wizard-to-manifest.ts, compose-wizard-data.ts → @hexagen/wizard-orchestration
  M2.3  Migrate app/config/
         - models.ts, cloud-providers.ts → @hexagen/local-llm/domain/
         - delete apps/web/app/config/
  M2.4  Codemod consumer imports
  Gate: apps/web/app/lib/ contains only browser utils + wire.ts +
        wire.project-generation.ts; apps/web/app/config/ removed

Stage 3 — HARD CUTOVER ACL (CV-4; depends on Stage 2) ✅ COMPLETED 2026-04-22
  A3.1  Remove LLMMessage from @hexagen/local-llm public barrel
        → Marked @internal; import type still allowed (S3.Q3)
  A3.2  Expose only SendStructuredRequestPort from composition root
        → + ModelLifecyclePort; wire.ts registers both new ports
  A3.3  Rewrite call sites to use LLMRequest + schema
        → 5 sites migrated; FreeFormStringSchema for chat; Zod for governance
  A3.4  ESLint + Layer 3 enforcement (features/** and hooks/** blocked)
        → no-restricted-imports with allowTypeImports; boundary script extended
  Gate: grep -rn "LLMMessage\\[\\]" apps/web → 0 results;
        only wire.ts imports LocalLLMProviderPort (composition root exemption)

Stage 4 — FIREWALL HARDENING (CV-5; per D4) ✅ COMPLETED 2026-04-22
  F4.1  Layer 1: NoSemanticState<T> = Omit<T, ForbiddenPropKeys> & __HexagenSemanticState + type-test fixture
  F4.2  Layer 2: @hexagen/eslint-plugin-ui package
        - hexagen-ui/no-information-state (ui/** only)
        - hexagen-ui/no-kernel-imports (ui/** only)
        - hexagen-ui/no-feature-slice-imports (features/** only, workspace-shell exempted)
  F4.3  Layer 3: rewrite validate-ui-boundary.sh; single source
         scripts/firewall-blocklist.yaml shared with Layer 2
  F4.4  Remove cross-slice imports
        - governance-assistant → project-wizard: replaced with WIZARD_STEP_ORDER from @hexagen/prompt-compiler
        - code-view → monaco-editor: replaced with editorSlot render prop (injected by workspace-shell)
  Gate: red-path fixtures fail at all three layers; no cross-slice imports remain

Stage 5 — MVK DRIFT FIX (CV-7 per D2)
  V5.1  Compilation pass cp-2026-04-22-01:
         - spec-v1.md unchanged on DomainCommand
         - drift-report-v1.md: add "Resolved Drift" section
         - domain-command.ts: remove BaseDomainCommand; remove lineageId/timestamp
  V5.2  Add machine-enforced spec↔TS drift test
  V5.3  Update consumers (intent-compiler, transaction-system,
        reconciliation-engine) to source lineage from IntentLineage only
  Gate: spec↔TS shape test green; no consumer reads command.lineageId

Stage 6 — CLEANUP
  C6.1  ui manifest cleanup (AS-6)
  C6.2  Composition-root exception in layer-rules.yaml (AS-8)
  C6.3  Drop manifest-level no-restricted-imports (AS-9)
  C6.4  Delete/populate phantom BCs (AS-10)
  C6.5  Populate generator.config.yaml ownership (AS-13)
  C6.6  Codemod to @hexagen/ui subpaths + rule (AS-15)
  C6.7  Fill packages/ui/__tests__/ (AS-16)
  Gate: yarn test passes; bundle size re-measured against 50 KB target
```

### Execution DAG

```
             Stage 0 ─── must land first
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
 Stage 1     Stage 2      Stage 5
(governance) (migration)  (MVK drift)
     │           │           │
     │           ▼           │
     │       Stage 3         │
     │        (ACL)          │
     │           │           │
     │           ▼           │
     │       Stage 4         │
     │      (firewall)       │
     │           │           │
     └───────────┴───────────┘
                 │
                 ▼
             Stage 6
           (cleanup)
```

### Mode discipline per stage (AGENTS.md §3)

| Stage | Mode                       | Rationale                                                      |
| ----- | -------------------------- | -------------------------------------------------------------- |
| 0     | 🔨 Develop                 | Minimal, scoped fixes to unbreak build                         |
| 1     | 🏗️ Architect → 🔨 Develop  | Manifest changes require Architect; then Develop for consumers |
| 2     | 🔨 Develop (batched/slice) | File moves + codemods                                          |
| 3     | 🏗️ Architect → 🔨 Develop  | Port surface change in `local-llm` is a kernel contract change |
| 4     | 🔨 Develop                 | New plugin package + shell refactor                            |
| 5     | 🏗️ Architect → 🔨 Develop  | New compilation pass = Architect Mode emission                 |
| 6     | 🔨 Develop                 | Janitorial                                                     |

---

## Part H — Stage 0 Ready-to-Go Atomic Units

When authorized, these are the first contiguous actions:

1. Clean tree: `rm -rf packages/*/dist .turbo packages/*/.turbo` + `find . -name "*.tsbuildinfo" -delete`.
2. Delete `packages/core-domain/src/**/*.{d.ts,d.ts.map,js}` (36 files).
3. Edit `packages/local-llm/src/domain/model-catalog.ts:1` — `import type { DomainModelId, ... }` → `import { DomainModelId }; import type { ... }` (split so the enum is a value import).
4. Edit `packages/local-llm/src/application/use-cases/recommend-model.use-case.ts:3` — replace `@hexagen/local-llm` self-import with relative path to `../../domain/model-catalog.js`.
5. Run `yarn build && yarn typecheck && yarn lint && yarn lint:arch` — all four must be green.
6. Write `scripts/validate-src-purity.sh` (not CI-gated yet).
7. Commit: `fix(build): clean src-embedded artifacts and local-llm typecheck (stabilize Stage 0)`.

---

## Part I — Summary

**What Batch 1 got right**: the architectural principles (three-plane topology, contracts-first, atomic phased work, co-emission rigor, 3-layer firewall concept) are sound. Decisions Q1–Q12 remain useful policy.

**What Batch 1 got wrong**: the present-tense state ("Phase 0 PENDING"). Work described as pending has been executed in commits `5e3e47f` (Phase 0), `08b67e6` (Phase 1), `d16886f` (Phase 3.A), `c4c13d1` (Phases 4–6 scaffolds), `797646b` (Phase 4), `510070d` (Phase 5), `4a4da57` (Phase 6 tests), `457c28f` (Phase 7 in flight).

**What Batch 2 got wrong**: the verdict. The system is **not** at 8.5/10 production-ready. It does not typecheck. The information-state firewall is structurally defective in all three layers. The LLM ACL is declared but unenforced. Cross-feature-slice imports exist. ADR 0018 is a stub. The manifest does not reflect the filesystem. Migration is half-done.

**Actual current state**: **mid-Phase-7 with a broken Stage-0 build.** Plane-separation goals are visible at the folder-structure level and largely realized at the package level, but the enforcement surface (firewall + ACL + arch-lint + manifest) is too weak to hold the invariants under developer pressure.

**Path forward**: six stages as above, starting with Stage 0 to unblock the build. Decisions D1–D5 locked.

---

## Appendix A — Evidence: `git log`

```
457c28f refactor(Phase 7): migrate grounded-prompt to prompt-compiler
4a4da57 test(Phase 6): add property-based tests for domain invariants
510070d feat(prompt-compiler,local-llm,reconciliation-engine): complete Phase 5 — probabilistic layer
797646b feat(transaction-system): complete Phase 4 — transaction lifecycle, speculative state, backpressure coalescing, semantic cache
a8edecb chore: gitignore .js build artifacts in packages/*/src/
d16886f refactor(intent-compiler): complete Phase 3.A DDD restructure with port-based test contracts
5294447 fix(mcp-server): resolve relative workspace-root paths and fix start script
b7defb8 fix(mcp-server): stabilize server process to prevent connection closed errors
654706f fix(lint): resolve no-console warnings and remove unused eslint-disable
8bb06e1 docs(architecture): add Phase 3-7 execution plan v1
a1954e7 refactor(web): complete Phase 1.7 — consolidate app/ composition root
e338e91 feat: complete Phase 0/1 + scaffold Phase 4-6 + fix post-refactor tooling
7393112 feat: migrate app/components to feature folders + @hexagen/ui sections/modules
c4c13d1 feat: add Phase 4-6 packages (transaction-system tests, prompt-compiler, reconciliation-engine, core-domain property tests)
fbfab3b feat(transaction-system): scaffold Phase 4 transaction orchestration package
ca4d2ec fix(intent-compiler): resolve TS2339 errors, add arch-lint compliance, and tests
e7f94b6 feat(intent-compiler): implement core validation modules
08b67e6 feat(ui): scaffold Phase 1 projection kernel isolation (atomic units 1.1-1.5)
e370d18 fix(core-domain): resolve TypeScript build errors and eslint config
5e3e47f chore: complete Phase 0 MVK compilation pass (atomic units 0.0-5.0)
```

## Appendix B — Evidence: file counts & build output

### Packages present (28)

```
agentic-interaction     external-integration    persistence             shared
architectural-enforcement   intent-compiler     project-configuration   sync
code-generation         local-llm               project-generation      transaction-system
core-domain             mcp-server              prompt-compiler         ui
deployment              messaging               reconciliation-engine   visualization
monaco-orchestration    runtime                 web-driver              wizard-orchestration
```

Plus `layout-engine`, `ui-projection-compiler`.

### `.architecture/` layout

```
.architecture/
├── decisions/               22 ADRs (0000–0021); 0005 is 0 bytes; 0018 is a 53-line stub
├── generator.config.yaml    5 533 bytes (stale per MANIFEST_AUTOMATION_SUMMARY.md)
├── invariants/
│   ├── layer-rules.yaml     30 lines
│   └── linter-config.yaml   106 lines
├── manifest.yaml            841 lines; no planes: overlay
├── mvk/
│   ├── drift-report-v1.md   109 lines
│   └── spec-v1.md           484 lines
├── plans/
│   └── phase-3-7-execution-plan-v1.md   787 lines
└── README.md
```

### Feature slices (7)

```
apps/web/features/
├── code-view/
├── export/
├── governance-assistant/
├── hexagon-canvas/
├── monaco-editor/
├── project-wizard/
└── workspace-shell/
```

### Build failure excerpt

```
@hexagen/local-llm:typecheck: src/application/use-cases/recommend-model.use-case.ts(3,15):
  error TS2305: Module '"@hexagen/local-llm"' has no exported member 'ModelDescriptor'.
@hexagen/local-llm:typecheck: src/domain/model-catalog.ts(50,14):
  error TS1361: 'DomainModelId' cannot be used as a value because it was imported using 'import type'.
@hexagen/local-llm:typecheck: src/domain/model-catalog.ts(63,14): error TS1361: ...
@hexagen/local-llm:typecheck: src/domain/model-catalog.ts(76,14): error TS1361: ...
@hexagen/local-llm:typecheck: src/domain/model-catalog.ts(90,14): error TS1361: ...
@hexagen/local-llm:typecheck: src/domain/model-catalog.ts(103,14): error TS1361: ...
@hexagen/local-llm:typecheck: src/domain/model-catalog.ts(117,14): error TS1361: ...
@hexagen/local-llm:typecheck: src/domain/model-catalog.ts(130,14): error TS1361: ...
@hexagen/local-llm:typecheck: ERROR: command finished with error: exited (2)

 Tasks:    44 successful, 46 total
 Failed:   @hexagen/local-llm#typecheck
```

### UI boundary check (misleading green)

```
🛡️  UI Boundary Validation (Layer 3 — CI Structural Check)
Checking for forbidden kernel imports...
Checking for feature slice imports...
Checking for semantic state tokens in UI source...
Checking @hexagen/* import whitelist...
✅ UI Boundary Check PASSED — no violations found
```

Check 3 is warning-only; kernel pkg list missing `@hexagen/ui-projection-compiler`, `@hexagen/layout-engine`, `@hexagen/local-llm`, `@hexagen/agentic-interaction`, `@hexagen/mcp-server`. Green here does not imply invariant compliance.

---

_End of report. Review conducted in read-only mode; no production files were modified. This document is the authorized record of findings._
