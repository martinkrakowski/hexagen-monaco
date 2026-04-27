# Code Review Report: Phases 0-2 Remediation

**Date:** 2026-04-25
**Scope:** Verification of claimed Phase 0-2 completions against actual codebase state

---

## Phase 0 — Lock Enforcement

### 0.1 Remove `@hexagen/* → packages/*/src` aliasing from `next.config.mjs`

**Claimed:** Done
**Finding: PARTIALLY DONE**

`next.config.mjs` no longer contains explicit `resolve.alias` entries mapping `@hexagen/*` to `packages/*/src`. However:

- `tsconfig.base.json:17-68` still contains **full source-level `paths` resolution** for 14+ packages (e.g., `"@hexagen/project-configuration": ["./packages/project-configuration/src/index.ts"]`). The catch-all `"@hexagen/*": ["./packages/*/src/index.ts"]` at line 62 remains. This means TypeScript still resolves all packages directly to source.
- The `next.config.mjs` changes (`transpilePackages`, `extensionAlias`, `conditionNames`) help webpack resolve packages but do not eliminate the TypeScript-level source bypass.
- **The root cause is unchanged: `tsconfig.base.json` is the primary boundary bypass mechanism, not `next.config.mjs`.**

### 0.2 Add missing dependency declarations

**Claimed:** Done
**Finding: DONE**

`apps/web/package.json` declares all `@hexagen/*` workspace dependencies explicitly (lines 16-31). No missing declarations found.

### 0.3 Clear inherited paths in every package tsconfig

**Claimed:** Done (10 packages)
**Finding: DONE — 27 of 28 packages**

All 27 checked packages have `"paths": {}` in their tsconfig, correctly overriding the root `paths`. This is actually better than claimed (10 → 27).

### 0.4 Expand `tsconfig.base.json` references

**Claimed:** Done (28 packages)
**Finding: DONE**

`tsconfig.base.json:70-99` lists all 28 packages in `references`.

### 0.5 Boundary check: illegal import fails `lint:arch`

**Claimed:** Partial
**Finding: CONFIRMED PARTIAL**

`web-driver/src/domain/index.ts:3-7` still re-exports `@hexagen/local-llm` types, which is **not** in the linter's `allowed_imports` for `web-driver` (linter-config.yaml:15-23 allows only `@hexagen/shared`, `@hexagen/visualization`, `@hexagen/agentic-interaction`). This violation should fail `lint:arch` but reportedly does not — confirming the linter coverage gap.

---

## Phase 1 — Complete Published Language

### 1.1 Expand `NodeVisualSpec` beyond nodeId stub

**Claimed:** Done — `{ nodeId, kind: NodeKind, label, category? }`
**Finding: DONE**

`node-visual-spec.ts:14-18` confirms the interface now carries `nodeId`, `kind`, `label`, and optional `category`.

### 1.2 Define kernel-owned vs projection-owned fields

**Claimed:** Done
**Finding: DONE**

`kind` and `label` are kernel-authored (from `NodeKind` and `Identifier`), `category` is an optional projection hint.

### 1.3 Introduce concrete visualization contract

**Claimed:** Done — `NodeVisualProps` + variant/compilerCategory
**Finding: PARTIAL**

`NodeVisualProjection` in `map-node-visual.port.ts:4-9` is well-defined with `nodeId`, `variant`, `label`, `category`. However, `NodeVisualStyle` in `visualization/src/domain/model/node-visual-style/node-visual-style.ts:3-6` remains **empty** — the same stub as before the remediation. The claim of a "concrete visualization contract" is only partially true: the projection contract exists, but the visualization domain model is still a placeholder.

### 1.4 Change compiler ports to take kernel-owned inputs

**Claimed:** Done
**Finding: DONE**

`MapNodeVisualPort.map(spec: NodeVisualSpec)` in `map-node-visual.port.ts:12` takes `NodeVisualSpec`, not loose strings.

### 1.5 Remove placeholder outputs from compiler path

**Claimed:** Done — `NodeVisualProjection.category` is now `VisualVariantCategory`
**Finding: DONE**

`DefaultNodeVisualMapperAdapter` returns `VisualVariantCategory` (union of 13 known values), not free-form strings. The `categoryFromNodeKind()` function provides deterministic enum dispatch.

---

## Phase 2 — Move Projection out of React

### 2.1 Delete `classify-adapter-label.ts`

**Claimed:** Done
**Finding: DONE**

File confirmed absent from `apps/web/features/hexagon-canvas/lib/`.

### 2.2 Move graph construction out of `useCanvasState`

**Claimed:** Partial
**Finding: CONFIRMED PARTIAL — STILL MATERIALLY BROKEN**

`useCanvasState.ts` still contains:

- `hexagonTypeToNodeKind()` (lines 20-41) — **semantic compilation in React**: converts string types to `NodeKind` enum
- `applyDagreLayout()` (lines 68-99) — **layout logic in React** instead of `@hexagen/layout-engine`
- `createDefaultHexagonNode()` (lines 101-114) — node construction in React
- Direct call to `generateHexagonalContextMap(wizardData)` (line 158) — **all four `generate-*` helpers still in `apps/web/features/hexagon-canvas/lib/`**
- The projection pipeline is wired (lines 159-178) but it operates on data that React still classifies and constructs

The `generate-*` files still exist:

- `generate-bounded-context-nodes.ts` (315 lines)
- `generate-hexagonal-context-map.ts`
- `generate-external-peers.ts`
- `generate-peer-mapping-edges.ts`
- `config.ts`

**This is the single largest remaining violation.** React still owns the entire graph construction pipeline.

### 2.3 `BoundedContext.tsx` consumes render-ready data only

**Claimed:** Done
**Finding: MOSTLY DONE — MINOR RESIDUAL**

`BoundedContext.tsx` no longer contains `CvaVariantResolverAdapter`, `resolveVariantForNodeType`, `getPortCategoryStyle`, or `KNOWN_CATEGORIES`. It reads `data.variant` and `data.compilerCategory` from props. However:

- Line 20: `compilerCategory?: string` — still typed as `string`, not `VisualVariantCategory`
- Lines 222, 276-278: falls back to `nodeType.toUpperCase()` when `compilerCategory` is absent — this is a soft fallback, not a hard failure
- Lines 428-467: handle colors are hardcoded (`!bg-sky-500`, `!bg-amber-500`, `!bg-violet-500`) — these are presentation-level but still React-owned semantics

### 2.4 `HexagonCanvas.tsx` no longer derives edge colors from domain categories

**Claimed:** Done
**Finding: MOSTLY DONE — MINOR RESIDUAL**

`HexagonCanvas.tsx` no longer contains `EDGE_COLOR_CATEGORIES` or `edgeVariantResolver`. Edge colors now come from `variant.hexColor` (line 101-104). However:

- Line 116: `const isSK = edge.label === "SK"` — shared-kernel detection is still React-side string matching
- Line 116: `const edgeColor = isSK ? "#a78bfa" : getEdgeColor(sourceNode)` — hardcoded SK color `#a78bfa` is React-owned

### 2.5 Remove `projectId="demo"` from preview hot path

**Claimed:** Done
**Finding: DONE**

`ArchitecturePreviewPane.tsx` no hardcodes `projectId`. `ArchitectureGraphProviderAdapter` now returns explicit failure (lines 11-17). `architecture-viewer/page.tsx` no longer passes `projectId`.

### 2.6 Wire `MapNodeVisualUseCase` into composition root

**Claimed:** Done
**Finding: DONE**

`wire.ts:200-203` correctly wires `CvaVariantResolverAdapter → DefaultNodeVisualMapperAdapter → MapNodeVisualUseCase`.

### 2.7 `DefaultNodeVisualMapper` uses `categoryFromNodeKind()`

**Claimed:** Done
**Finding: DONE**

`default-node-visual-mapper.adapter.ts:60` delegates to `categoryFromNodeKind(kind)` as fallback.

---

## Critical Unaddressed Violations (Found During Review)

### C1. `tsconfig.base.json` still bypasses all boundaries

The root `paths` object (lines 17-68) maps every `@hexagen/*` package to its `src/` directory. While individual package tsconfigs override with `"paths": {}`, the **app-level `apps/web/tsconfig.json`** was not checked and likely inherits these paths. This means the TypeScript compiler for the web app still resolves through source, making boundary enforcement advisory.

### C2. `web-driver` still re-exports `@hexagen/local-llm`

`packages/web-driver/src/domain/index.ts:3-7` exports `LLMEngineState`, `LLMEngineStatus`, `createLLMEngineState`, and `LLM_ENGINE_INITIAL_STATE` from `@hexagen/local-llm`. This is not in the linter's allowed imports for `web-driver`, and `lint:arch` does not catch it.

### C3. `@hexagen/shared` still exports foreign schemas

`packages/shared/src/types/architectural-schemas.ts` still contains `ManifestSchema`, `ArchitectureGraphSchema`, `LinterReportSchema`, and `ArchitecturalEventSchema` — all context-owned schemas that belong in their respective bounded contexts (Phase 4, not started).

### C4. `@hexagen/ui` still carries feature semantics

- `FileDropZone.tsx:83,101` — references "manifest YAML file" in aria-label and UI text
- `ViewToggle.tsx:6` — `ViewMode = "visual" | "code"` is app-specific vocabulary
- These are Phase 3 items (not started) but were flagged as still materially broken.

### C5. `useCanvasState` still performs semantic compilation

The `hexagonTypeToNodeKind()` function (lines 20-41) is a direct semantic classifier running in React. It maps string types like `"entity"`, `"use-case"`, `"port"`, `"adapter"` to `NodeKind` enum values. This is the exact violation the remediation report identifies as "React compiles domain semantics."

---

## Summary Table

| Claim                                           | Status         | Confidence                                   |
| ----------------------------------------------- | -------------- | -------------------------------------------- |
| Phase 0.1: Remove aliasing from next.config.mjs | Partial        | High — tsconfig.base.json still bypasses     |
| Phase 0.2: Add missing dependencies             | Done           | High                                         |
| Phase 0.3: Clear inherited paths (10 pkgs)      | Done (27 pkgs) | High                                         |
| Phase 0.4: Expand tsconfig references           | Done           | High                                         |
| Phase 0.5: Boundary check fails lint:arch       | Partial        | High — web-driver violation undetected       |
| Phase 1.1: Expand NodeVisualSpec                | Done           | High                                         |
| Phase 1.2: Define kernel vs projection fields   | Done           | High                                         |
| Phase 1.3: Concrete visualization contract      | Partial        | High — NodeVisualStyle still empty           |
| Phase 1.4: Compiler ports take kernel inputs    | Done           | High                                         |
| Phase 1.5: Remove placeholder outputs           | Done           | High                                         |
| Phase 2.1: Delete classify-adapter-label.ts     | Done           | High                                         |
| Phase 2.2: Move graph construction out of React | **Not Done**   | High — generate-\* helpers still in apps/web |
| Phase 2.3: BoundedContext consumes render-ready | Mostly Done    | Medium — minor residual fallbacks            |
| Phase 2.4: HexagonCanvas no derivation          | Mostly Done    | Medium — hardcoded SK color                  |
| Phase 2.5: Remove projectId="demo"              | Done           | High                                         |
| Phase 2.6: Wire MapNodeVisualUseCase            | Done           | High                                         |
| Phase 2.7: categoryFromNodeKind()               | Done           | High                                         |

---

## Residual Risks

1. **Highest risk:** `tsconfig.base.json` source paths remain the single largest boundary bypass. Until these are removed, all other boundary enforcement is advisory.
2. **Second highest:** `generate-*` helpers in `apps/web` mean Phase 2 is not 80% complete — it is ~40% complete. The projection pipeline is wired but the graph construction it operates on is still React-owned.
3. **Linter false confidence:** `lint:arch` passes while `web-driver` violates its declared import policy. The governance signal is weaker than claimed.
4. **NodeVisualStyle empty:** The visualization domain model is still a stub, meaning the "concrete visualization contract" claim is only half-true.
