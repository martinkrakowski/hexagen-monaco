# HexaGen Monaco Architectural Remediation Report

Date: 2026-04-24
Source review: `docs/architectural-review-2026-04-24.md`
Related remediation: `docs/style-remediation-plan.md`

## Executive Summary

The repository does not need a new architecture. It needs the declared architecture to become the only executable path.

The main remediation priority is not UI polish or package reshuffling. It is authority transfer:

1. Make package boundaries real.
2. Complete the published language between kernel and projection.
3. Move semantic compilation out of React.
4. Remove shared-kernel ownership drift.
5. Bind the LLM path to compiled contracts instead of ad hoc request construction.

Current state:

- Build, typecheck, and lint pass.
- `lint:arch` passes, but the audit showed that this signal is currently incomplete.
- The earlier style failure is no longer the critical path. Tailwind scanning and token cleanup appear to be largely corrected already.

Final objective:

- React renders only projection outputs.
- `@hexagen/ui` consumes neutral contracts only.
- the monorepo fails deterministically when a package crosses a boundary.
- the GR-AST -> MVK -> RRP -> REM path becomes runtime authority, not documentation.

## Remediation Principles

1. Fix enforcement before adding more abstraction.
2. Move hot paths first.
3. Remove silent fallback behavior.
4. Prefer one authoritative contract over duplicated helper types.
5. Freeze aspirational package growth until each package owns a real runtime responsibility.

## Priority Matrix

| Priority | Problem                                    | Impact   | Why first                                                                 |
| -------- | ------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| P0       | Boundary enforcement is bypassable         | Critical | Every other guarantee is untrustworthy while packages resolve raw source  |
| P1       | Published language is incomplete           | Critical | React cannot be conformist until the contract exists                      |
| P2       | Canvas/UI compile semantics locally        | Critical | This is the main live-path architectural violation                        |
| P3       | Shared kernel owns foreign schemas         | High     | Context ownership remains blurred and spreads drift                       |
| P4       | LLM pipeline is off-contract               | High     | Deterministic governance claims are not yet reflected in runtime behavior |
| P5       | UI package still carries feature semantics | Medium   | Important, but should follow published-language completion                |
| P6       | Linter coverage is incomplete              | High     | Governance cannot self-validate today                                     |

## Status Snapshot

Already improved or partially remediated:

- `apps/web/tailwind.config.ts` now scans `features` and `packages/ui/src`.
- `packages/ui/tailwind.preset.ts` is gone.
- `packages/ui/src/tokens/*.css` dead files are gone.

Still materially broken:

- source-level aliasing in TypeScript and Next.js bypasses exports.
- `NodeVisualSpec` is still a stub.
- `ui-projection-compiler` still reconstructs semantics from caller-supplied strings.
- the canvas path still converts `WizardData` into graph semantics inside `apps/web`.
- `web-driver` still exposes demo-driven graph behavior.
- prompt/reconciliation/transaction packages are not yet aligned to real RRP/REM authority.

## Remediation Program

## Phase 0 - Lock Enforcement

Goal: make boundary violations fail deterministically.

### Work items

1. Remove app-level aliasing of `@hexagen/*` package names to sibling `src` directories in `apps/web/next.config.mjs`.
2. Add missing direct dependency declarations where imports already exist, starting with `@hexagen/ui` in `apps/web/package.json`.
3. Clear inherited `paths` in every package tsconfig that should consume published exports only, not root source aliases.
4. Expand architectural linter coverage so all bounded contexts are actually loaded into the lint project.
5. Add a boundary check that fails when a workspace import resolves outside a package's public exports.

### Files/packages in scope

- `tsconfig.base.json`
- `apps/web/next.config.mjs`
- `apps/web/package.json`
- package-level `tsconfig.json` files, especially newer kernel/projection packages
- `tools/arch-linter/**`

### Acceptance gates

1. `apps/web` builds without source aliasing to sibling `src` directories.
2. every package imports other packages through declared workspace dependencies only.
3. a deliberate illegal import in `web-driver` fails `lint:arch`.
4. removing a package export causes deterministic build failure in dependents.

### Exit criteria

- package boundaries become mechanically enforced.
- green architecture checks mean something again.

## Phase 1 - Complete the Published Language

Goal: define the minimum render contract required for conformist projection.

### Work items

1. Expand `packages/core-domain/src/mvk/v1/node-visual-spec.ts` beyond `nodeId`.
2. Define which fields are kernel-authored versus projection-authored.
3. Introduce a concrete visualization contract in `packages/visualization` instead of the empty `NodeVisualStyle` placeholder.
4. Change `ui-projection-compiler` ports so callers pass kernel-owned inputs, not raw `kind` and `category` strings.
5. Remove `label: ""` and similar placeholder outputs from the compiler path.

### Contract minimums

The first complete published language should cover at least:

- node identity
- display label
- semantic classification
- affordance flags
- connection/handle metadata needed by the renderer
- stable variant token or projection category

It does not need to include theme-resolved colors if those remain projection-owned, but it must include enough semantic information that React no longer invents them.

### Files/packages in scope

- `packages/core-domain/**`
- `packages/ui-projection-compiler/**`
- `packages/visualization/**`

### Acceptance gates

1. `NodeVisualSpec` is used by real consumers, not only tests and stubs.
2. the compiler does not accept free-form semantic strings from React.
3. the visualization package exposes a non-empty render contract.
4. the canvas feature can render from compiled projection data without feature-local classification helpers.

## Phase 2 - Move Projection Compilation out of React

Goal: remove semantic graph generation from `apps/web/features/hexagon-canvas`.

### Work items

1. Replace `generate-hexagonal-context-map.ts`, `generate-bounded-context-nodes.ts`, `generate-external-peers.ts`, `generate-peer-mapping-edges.ts`, and `classify-adapter-label.ts` with an application-layer graph/projection path.
2. Move graph construction from `useCanvasState` into `web-driver`, `visualization`, or another explicit application service.
3. Make `BoundedContext.tsx` and `HexagonCanvas.tsx` consume render-ready node/edge models only.
4. Eliminate React-owned semantic connection validation that depends on domain-side naming or side semantics.
5. Remove `projectId="demo"` from the architecture preview hot path.

### Target runtime shape

`WizardData or DomainAST -> application adapter -> projection compiler -> visualization contract -> React renderer`

Not:

`WizardData -> feature-local graph generation -> feature-local semantic coloring -> ReactFlow`

### Files/packages in scope

- `apps/web/features/hexagon-canvas/**`
- `apps/web/features/workspace-shell/ArchitecturePreviewPane.tsx`
- `packages/web-driver/**`
- `packages/ui-projection-compiler/**`
- `packages/visualization/**`

### Acceptance gates

1. feature-local graph generation helpers are deleted or reduced to presentational adapters only.
2. `BoundedContext.tsx` no longer resolves semantic categories from node types.
3. `HexagonCanvas.tsx` no longer derives edge colors from domain-side categories.
4. the preview path renders real project/workspace data, not demo fallback data.

## Phase 3 - Make `@hexagen/ui` Strictly Conformist

Goal: ensure the design system is presentation-only.

### Work items

1. Move manifest-specific dropzone behavior out of `packages/ui/src/modules/FileDropZone.tsx` into a feature-local wrapper.
2. Replace feature-specific vocabulary like `ViewMode = "visual" | "code"` in `@hexagen/ui` with a generic toggle API.
3. Apply `NoSemanticState` consistently across modules and sections, not just elements.
4. Align token helpers with the current design vocabulary and remove stale semantic names like `error` if `destructive` is canonical.

### Files/packages in scope

- `packages/ui/src/modules/**`
- `packages/ui/src/sections/**`
- `packages/ui/src/tokens/**`
- consuming feature wrappers under `apps/web/features/**`

### Acceptance gates

1. `@hexagen/ui` contains no manifest-specific text or file-type semantics.
2. package-local modules expose generic props only.
3. the semantic-state firewall applies across elements, modules, and sections.
4. feature-specific wrappers live under `apps/web/features/*`, not `packages/ui`.

## Phase 4 - Repatriate Shared-Kernel Ownership

Goal: shrink `@hexagen/shared` back to true shared primitives.

### Work items

1. Inventory every schema currently exported from `packages/shared/src/types/architectural-schemas.ts`.
2. Move each schema to its owning bounded context.
3. Update import sites in `sync`, `project-configuration`, `visualization`, governance/linter code, and any app consumers.
4. Leave only true shared kernel primitives in `@hexagen/shared`.

### Desired ownership

- wizard DTOs -> `wizard-orchestration`
- manifest/schema language -> `project-configuration`
- graph contracts -> `visualization`
- linter/governance report contracts -> linter or governance package
- cross-cutting identifiers/results/errors -> `shared`

### Acceptance gates

1. `packages/shared/src/index.ts` exports only genuine shared-kernel primitives.
2. no bounded-context-specific schemas are re-exported from `shared`.
3. moving a context-owned schema no longer requires touching the shared kernel.

## Phase 5 - Align Prompt, Transaction, and Reconciliation to Real Contracts

Goal: make the AI pipeline consume compiled authority rather than ad hoc messages and shadow types.

### Work items

1. Redesign prompt-compiler input ports around compiled kernel contracts instead of loose `DomainAST`, `governanceRules`, `name`, `description`, and `exampleData` inputs.
2. Remove UI-side construction of raw `LLMRequest` objects.
3. Introduce a single adapter boundary from the app into `local-llm` that accepts already-compiled prompt and schema payloads.
4. Update transaction execution so REM and lineage are real inputs rather than comment-level intent.
5. Replace `DomainASTLike` and text-line patch parsing in `reconciliation-engine` with kernel-owned types and structured outputs.

### Files/packages in scope

- `packages/prompt-compiler/**`
- `packages/local-llm/**`
- `packages/transaction-system/**`
- `packages/reconciliation-engine/**`
- `apps/web/features/llm-driver/**`

### Acceptance gates

1. the UI cannot construct an arbitrary `LLMRequest` directly.
2. prompt compilation consumes compiled contracts.
3. reconciliation consumes structured, validated output instead of line parsing.
4. transaction execution binds actual REM and lineage inputs.

## Phase 6 - Remove Aspirational Drift

Goal: reduce ceremonial architecture and align packages to real runtime value.

### Work items

1. Audit packages whose primary runtime behavior is still stubbed: `intent-compiler`, `ui-projection-compiler`, `layout-engine`, `reconciliation-engine`.
2. For each package, choose one of three actions:
   - complete it now
   - narrow its surface until it reflects real runtime responsibility
   - freeze it and stop routing new abstractions through it
3. Remove dependency drift in `package.json` and manifest/linter config.

### Acceptance gates

1. every kernel/projection package has at least one real runtime consumer on the main path.
2. package manifests match architectural policy.
3. no package advertises authority it does not yet exercise.

## Recommended Execution Order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3 and Phase 4 in parallel
5. Phase 5
6. Phase 6

This order matters.

If Phase 0 is skipped, every later improvement still runs on bypassable boundaries.
If Phase 1 is skipped, Phase 2 pushes more semantics into app code because the published language is still missing.
If Phase 2 is skipped, conformist UI cleanup becomes cosmetic.

## Risks During Remediation

| Risk                                                                                     | Likelihood | Impact | Mitigation                                                                                |
| ---------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------- |
| boundary hardening breaks builds that currently depend on source aliasing                | High       | High   | do Phase 0 first on a dedicated branch and fix imports package-by-package                 |
| published-language design overreaches and recreates domain logic in projection contracts | Medium     | High   | define the thinnest contract that still removes React-side semantic inference             |
| moving canvas compilation out of app code causes behavior regressions                    | Medium     | High   | snapshot current graph outputs and compare compiled output before swapping runtime wiring |
| shared-kernel extraction fans out into too many edits                                    | High       | Medium | move one ownership cluster at a time: manifest, graph, linter, wizard                     |
| AI pipeline alignment stalls because current packages are scaffold-heavy                 | High       | Medium | narrow the first cut to one real end-to-end path before generalizing                      |

## Success Metrics

The remediation is complete when all of the following are true:

1. `apps/web` does not alias `@hexagen/*` to sibling `src` folders.
2. `lint:arch` catches the existing class of `web-driver` boundary violations.
3. `NodeVisualSpec` is a real contract used on the live canvas path.
4. React canvas code does not classify adapters, color edges by domain category, or generate graph semantics from `WizardData`.
5. `@hexagen/ui` contains no manifest-specific or feature-specific vocabulary.
6. `@hexagen/shared` no longer exports context-owned schemas.
7. the UI cannot create raw LLM request payloads directly.
8. reconciliation no longer parses free-form line syntax against `DomainASTLike`.

## What Not to Do

1. Do not add more packages before Phase 0 through Phase 2 are complete.
2. Do not treat `lint:arch` green as proof of integrity until linter coverage is fixed.
3. Do not refactor canvas rendering cosmetically while semantic compilation still lives in React.
4. Do not widen `shared` further to make migrations easier.
5. Do not add richer LLM orchestration on top of the current ad hoc request path.

## Recommended First Batch

If this work starts immediately, the highest-value first batch is:

1. remove `@hexagen/* -> packages/*/src` resolution from `apps/web/next.config.mjs`
2. declare missing package dependencies in `apps/web/package.json`
3. clear inherited TS `paths` in remaining packages
4. fix `arch-linter` project coverage
5. remove `projectId="demo"` from `ArchitecturePreviewPane`
6. design and ship the first non-stub `NodeVisualSpec`

That batch converts the current architecture from "well-described but bypassable" to "partially authoritative and testable".

## Final Recommendation

Treat this as an authority restoration project, not a cleanup sprint.

The repository already contains the right nouns. It is missing the hard cutover where those nouns become executable governance. Until that cutover happens, the system remains structurally impressive but operationally fragile.
