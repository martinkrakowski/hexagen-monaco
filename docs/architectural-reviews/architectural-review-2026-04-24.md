# HexaGen Monaco Architectural Review

Date: 2026-04-24
Scope: Full-system architectural audit of the production governance platform after the `apps/web/components` to `packages/*` refactor.

## Executive Summary

- Is the architecture fundamentally sound? Conditionally.
- Biggest strength: the repository has a coherent target architecture, explicit package topology, and enough contract scaffolding that the intended system is understandable and evolvable.
- Biggest risk: the live runtime path does not actually obey the declared authority model. React features still compile semantic meaning, package boundaries are bypassable through source-level resolution, and several "kernel" stages exist more as named scaffolds than as runtime authorities.

## Critical Violations (Must Fix)

1. Source-level package resolution bypasses published package boundaries.
   Location: `tsconfig.base.json:17-68`, `apps/web/next.config.mjs:88-128`, `apps/web/next.config.mjs:134-175`, `apps/web/package.json:13-29`, `apps/web/features/workspace-shell/ArchitecturePreviewPane.tsx:2-3`.
   Why it violates architecture: the monorepo claims package boundaries and published-language consumption, but TypeScript and Next resolve many `@hexagen/*` imports straight into sibling `src` directories. `apps/web` also imports `@hexagen/ui` without declaring it as a dependency. That means boundaries are advisory, not enforced, and packages can work only because the repo resolves raw source.
   Correct placement: packages must resolve through `package.json` exports and declared workspace dependencies only. Remove source aliases from app bundling, clear inherited TS `paths` in every package, and make undeclared dependencies fail deterministically.

2. The live canvas path bypasses the published language and compiles domain semantics inside React.
   Location: `apps/web/features/hexagon-canvas/hooks/useCanvasState.ts:133-167`, `apps/web/features/hexagon-canvas/lib/generate-bounded-context-nodes.ts:25-321`, `apps/web/features/hexagon-canvas/BoundedContext.tsx:67-147`, `apps/web/features/hexagon-canvas/HexagonCanvas.tsx:52-165`, `apps/web/features/hexagon-canvas/HexagonCanvas.tsx:218-239`.
   Why it violates architecture: React is still deciding node categories, edge colors, handle semantics, node kinds, graph construction, and connection validity directly from `WizardData` and feature-local heuristics. That is projection compilation and constraint semantics living in the UI, not in `@hexagen/ui-projection-compiler`, `@hexagen/layout-engine`, or `@hexagen/visualization`.
   Correct placement: `web-driver` or another application-layer adapter should publish graph/view DTOs, `ui-projection-compiler` should own semantic-to-visual mapping, and `layout-engine` should own constraint decisions. React should render those results only.

3. `NodeVisualSpec` is too thin to function as a real published language, so the UI is forced to fake the missing layer.
   Location: `packages/core-domain/src/mvk/v1/node-visual-spec.ts:7-8`, `packages/core-domain/src/mvk/v1/node-visual-spec.ts:20-62`, `packages/ui-projection-compiler/src/application/ports/in/map-node-visual.port.ts:4-17`, `packages/ui-projection-compiler/src/infrastructure/adapters/default-node-visual-mapper.adapter.ts:19-31`, `packages/visualization/src/domain/model/node-visual-style/node-visual-style.ts:3-6`.
   Why it violates architecture: the declared path is Kernel -> Published Language -> Conformist UI. In code, `NodeVisualSpec` carries only `nodeId`, the mapper still asks callers for raw `kind` and `category` strings, returns `label: ""`, and `NodeVisualStyle` is empty. That is not a published language; it is an empty shell around feature-owned semantics.
   Correct placement: enrich the published render contract so the UI receives a render-ready semantic projection. `ui-projection-compiler` should compile from kernel-owned types, not recover meaning from loose strings supplied by React.

4. `@hexagen/ui` is not a strict conformist context because it still contains domain-specific behavior and vocabulary.
   Location: `packages/ui/src/modules/FileDropZone.tsx:16-39`, `packages/ui/src/modules/FileDropZone.tsx:83-105`, `packages/ui/src/modules/ViewToggle.tsx:6-14`, `packages/ui/src/modules/Tabs.tsx:24-30`, `packages/ui/src/sections/Dialog.tsx:8-12`.
   Why it violates architecture: `FileDropZone` knows about `manifest.yaml`, YAML extensions, and manifest-specific user copy. `ViewToggle` hardcodes `"visual" | "code"` as app vocabulary. The semantic-state firewall is applied to elements but not consistently to modules and sections. This means the design system is partially generic and partially feature-aware.
   Correct placement: manifest-aware dropzones and workspace-specific toggles belong in `apps/web/features/*` or in a driver-facing projection package. `@hexagen/ui` should expose generic dropzone, tabs, dialog, and toggle primitives that consume neutral props only.

5. `@hexagen/shared` is acting as a dumping ground for other contexts' published language.
   Location: `packages/shared/src/index.ts:27-55`, `packages/shared/src/types/architectural-schemas.ts:16-107`, `packages/sync/src/application/use-cases/get-manifest-resource.use-case.ts:1-13`, `packages/sync/src/application/use-cases/get-architecture-graph.use-case.ts:1-17`, `packages/sync/src/application/use-cases/get-linter-report.use-case.ts:1-14`.
   Why it violates architecture: the shared kernel should be tiny. Instead it exports wizard DTOs, manifest schemas, architecture graph schemas, and linter report schemas, and downstream packages consume them from `shared`. That collapses context ownership and turns shared into a universal schema bucket.
   Correct placement: wizard contracts belong with wizard orchestration, manifest schemas with project configuration, graph contracts with visualization, and linter report contracts with the linter/governance path. Keep `shared` limited to true cross-cutting primitives.

6. `web-driver` republishes foreign domain language and the live UI still depends on a demo-only graph provider.
   Location: `packages/web-driver/src/domain/index.ts:3-7`, `.architecture/invariants/linter-config.yaml:15-23`, `packages/web-driver/src/infrastructure/adapters/architecture-graph-provider.adapter.ts:7-105`, `apps/web/features/workspace-shell/ArchitecturePreviewPane.tsx:51`.
   Why it violates architecture: `web-driver` re-exports `local-llm` state as part of its own domain surface even though its declared package rule does not allow that dependency. Separately, the architecture preview hardcodes `projectId="demo"`, which binds the production UI to a stub provider path. This is both a boundary leak and a silent degradation path.
   Correct placement: `web-driver` should either define its own view DTOs or consume local-llm through an explicit adapter contract. The preview pane should pass real workspace identity, and the graph provider must stop serving demo data as the active path.

7. The RRP/REM and reconciliation pipeline are off-contract and not authoritative at runtime.
   Location: `packages/prompt-compiler/src/application/ports/in/build-system-instruction.port.ts:7-28`, `packages/prompt-compiler/src/application/ports/in/generate-zod-schema.port.ts:7-28`, `packages/local-llm/src/domain/value-objects/llm-request.vo.ts:9-22`, `apps/web/features/llm-driver/local-llm/stream-assistant-response.ts:43-54`, `packages/transaction-system/src/application/use-cases/execute-transaction.use-case.ts:12-38`, `packages/reconciliation-engine/src/domain/llm-response.ts:3-42`, `packages/reconciliation-engine/src/infrastructure/adapters/ast-reconciliation.adapter.ts:31-60`.
   Why it violates architecture: prompt compilation still takes ad hoc `DomainAST`, `governanceRules`, and `name/description/exampleData` inputs rather than RRP-backed contracts. The UI constructs raw `LLMRequest` messages directly. Transaction execution mentions REM in comments but does not accept it. Reconciliation invents `DomainASTLike` and parses free-form `+ kind:id` text. The deterministic pipeline is not the runtime authority.
   Correct placement: prompt compilation should consume compiled kernel contracts, the UI should never build raw LLM requests, transaction execution should bind real REM and lineage inputs, and reconciliation should operate over kernel-owned types and validated structured outputs.

## Architectural Smells

1. The architecture linter gives false confidence.
   Location: `tools/arch-linter/src/index.ts:203-205`, `tools/arch-linter/src/index.ts:318-323`, `tsconfig.base.json:70-82`, `packages/web-driver/src/domain/index.ts:3-7`.
   Why it matters: the linter constructs a TypeScript project from `tsconfig.base.json`, which does not include all bounded contexts in `references`. `web-driver` therefore violates its own declared import policy while `lint:arch` still reports compliance. The governance signal is currently weaker than the repo claims.

2. Enforcement is inconsistent across packages.
   Location: `packages/web-driver/tsconfig.json:3-10`, `packages/layout-engine/tsconfig.json:1-17`, plus other package tsconfigs inheriting root `paths`.
   Why it matters: `web-driver` clears inherited `paths`, but many newer packages do not. Some packages therefore respect export boundaries while others still compile against sibling source. That makes boundary behavior depend on per-package configuration drift.

3. The conformist firewall inside `@hexagen/ui` is only partially applied.
   Location: `packages/ui/src/types/forbidden-brand.ts:37-64`, `packages/ui/src/elements/Button.tsx:44-49`, `packages/ui/src/elements/Card.tsx:8-8`, `packages/ui/src/modules/ViewToggle.tsx:8-14`, `packages/ui/src/modules/Tabs.tsx:24-30`, `packages/ui/src/sections/Dialog.tsx:8-12`.
   Why it matters: the element layer uses `NoSemanticState`, but modules and sections mostly do not. The repo has the right mechanism, but not the consistency required for it to be trustworthy.

4. Production UI still has a silent fallback to demo behavior.
   Location: `packages/web-driver/src/infrastructure/adapters/architecture-graph-provider.adapter.ts:97-103`, `apps/web/features/workspace-shell/ArchitecturePreviewPane.tsx:51`, `apps/web/app/architecture-viewer/page.tsx:12`.
   Why it matters: when the real graph path is absent, the user still gets a rendered experience rather than a hard failure. That makes architectural incompleteness look like success.

5. Package manifests and declared architecture drift from each other.
   Location: `packages/prompt-compiler/package.json:19-24`, `packages/reconciliation-engine/package.json:19-24`, `.architecture/invariants/linter-config.yaml:85-106`.
   Why it matters: the manifest says `prompt-compiler` and `reconciliation-engine` no longer depend on `intent-compiler`, but their package manifests still do. That is a governance drift problem, not just a dependency hygiene issue.

6. UI vocabulary is duplicated instead of published once.
   Location: `packages/ui/src/modules/ViewToggle.tsx:6`, `apps/web/features/workspace-shell/hooks/useWorkspaceShellUi.ts:17`.
   Why it matters: even basic presentation concepts like `ViewMode` have two owners. That is not severe by itself, but it is a good example of how the published language remains incomplete.

## Phase Gap Findings

1. Phase 3 is missing in the exact place the system says it should exist.
   Location: `packages/core-domain/src/mvk/v1/node-visual-spec.ts:20-62`.
   Finding: the contract that should bridge kernel semantics to projection is still a stub, so downstream code has nothing authoritative to conform to.

2. `ui-projection-compiler` is not yet compiling a true published language.
   Location: `packages/ui-projection-compiler/src/application/ports/in/map-node-visual.port.ts:11-16`, `packages/ui-projection-compiler/src/infrastructure/adapters/default-node-visual-mapper.adapter.ts:19-31`.
   Finding: callers still provide `kind` and `category`, and the adapter resolves semantics from free-form strings. The compiler is recovering meaning from UI input rather than receiving authority from the kernel.

3. Visualization still has no authoritative node style model.
   Location: `packages/visualization/src/domain/model/node-visual-style/node-visual-style.ts:3-6`.
   Finding: the style contract is empty, which is why feature code still owns colors, labels, and affordance rules.

4. The web app locally compiles graphs from wizard data because the published graph path is unfinished.
   Location: `apps/web/features/hexagon-canvas/hooks/useCanvasState.ts:133-141`, `apps/web/features/hexagon-canvas/lib/generate-bounded-context-nodes.ts:25-321`.
   Finding: Phase 3 is being faked in app code. The projection layer is not missing abstractly; it is missing on the exact hot path that users execute.

5. The LLM ACL is wrapper-shaped, not compiler-shaped.
   Location: `packages/local-llm/src/domain/value-objects/llm-request.vo.ts:9-22`, `apps/web/features/llm-driver/local-llm/stream-assistant-response.ts:43-54`, `packages/prompt-compiler/src/application/ports/in/build-system-instruction.port.ts:7-28`, `packages/prompt-compiler/src/application/ports/in/generate-zod-schema.port.ts:7-28`.
   Finding: the architecture says prompt compilation should reduce kernel state into constrained prompt/schema contracts. In code, the UI still assembles message arrays, and prompt inputs remain loosely shaped rather than RRP-bound.

6. Reconciliation is still an aspirational shell around ad hoc parsing.
   Location: `packages/reconciliation-engine/src/domain/llm-response.ts:3-42`, `packages/reconciliation-engine/src/infrastructure/adapters/ast-reconciliation.adapter.ts:31-60`.
   Finding: the package does not reconcile authoritative IR. It parses text lines into patches against a shadow AST type.

## Conformist Context Score

- Score: 4/10.
- The good: `@hexagen/ui` elements are mostly primitive, package-local, and guarded by `NoSemanticState`. The design-system cleanup also appears materially improved: `apps/web/tailwind.config.ts:7-14` scans `features` and `packages/ui/src`, and the old `packages/ui/src/tokens/*.css` surface is gone.
- The bad: the important runtime path is still not conformist. React features derive graph semantics from `WizardData`, `BoundedContext`, adapter labels, connection handles, and domain-side categories. `@hexagen/ui` itself still ships a manifest-aware dropzone and app-specific view vocabulary. A conformist context cannot be scored highly when the published language it is supposed to consume is still missing on the main execution path.

## Over-Engineering Assessment

- `@hexagen/ui-projection-compiler`: partially real, not yet authoritative. One adapter is actively used, but the contract is too weak and the compiler still depends on raw `kind` and `category` strings. Current cost is higher than current value.
- `@hexagen/reconciliation-engine`: aspirational and high-risk. It has package structure, ports, and use cases, but no trustworthy IR contract and no meaningful integration into the deterministic pipeline. This is currently ceremonial architecture.
- `@hexagen/intent-compiler`: mostly aspirational. `packages/intent-compiler/src/infrastructure/adapters/default-gesture-parser.adapter.ts:7-24` still returns a mock AST, so the package earns very little of the abstraction cost it introduces.
- `@hexagen/layout-engine`: somewhat justified conceptually, but not yet the authority. The app still uses local dagre layout in `apps/web/features/hexagon-canvas/hooks/useCanvasState.ts:44-75`, so the package has not displaced feature-level layout decisions.
- The repository's main over-engineering pattern is not "too many packages" by itself. It is declaring authoritative layers before the runtime path has actually moved under their control.

## What Makes This Senior vs Staff

- Senior-level strength: the repo shows strong decomposition instincts, deliberate contract naming, meaningful package segmentation, and the discipline to define future authority boundaries before scaling the feature set.
- Missing for staff-level validation: the governance mechanism is not yet authoritative enough to justify the claims being made. Staff-level architecture must make the intended path the only path, not one path among source aliases, demo fallbacks, and app-side semantic compilation.
- Senior-level code can describe the right layers.
- Staff-level architecture must make violations expensive, visible, and impossible to mistake for success.

## Final Verdict

- Strong but fragile under growth.
- Justification: the target architecture is coherent and the team has done real foundational work, but the repository is still held together by conventions and scaffolding at the exact points where it claims hard authority. The biggest risks are silent success modes: source aliasing hides dependency violations, the linter misses real leaks, React still performs semantic compilation, and stubbed providers keep incomplete subsystems looking operational. This system can scale only after the declared kernel and published-language boundaries become the mandatory runtime path rather than the documented ideal.
