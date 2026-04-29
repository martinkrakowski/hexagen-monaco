# Hexagonal Architecture Layout Remediation Report

Date: 2026-04-29
Branch: `feature/react-flow-visualizer-orchestration`
Prior context: `docs/COMPASS_LAYOUT_REMEDIATION.md` (2026-04-28)

## Executive Summary

The bounded-context visualization had three compounding layout defects that broke the hexagonal-architecture metaphor at the UI level: north/south handles were asymmetric with east/west (2 and 3 vs. 1 and 1), north adapters rendered east of their connection points, and the Clean-up button had no visible effect. This remediation unifies the four compass handles to one per side, centers adapters on their handles, anchors the bounded context to its generator-produced position, and rewires the Clean-up button to regenerate canonical nodes from `wizardData`.

All four defects are now resolved. The visualization correctly expresses the hexagonal-architecture pattern: one handle per compass side; adapters stack vertically above/below their handle; ports stack vertically west/east of their handle; ELK governs only the interior of the bounded context.

## Defect Catalog

### D1. Handle asymmetry contradicted the domain model

The `BoundedContext` component declared five handles on the hex edge: `north-0`, `north-1`, `south-0`, `south-1`, `south-2`. East and west each had a single shared handle. This asymmetry was historical, not principled — `generate-bounded-context-nodes.ts` currently emits at most two north adapters (API + UI framework) and three south adapters (messaging + persistence + telemetry), and the handle IDs were carved to that specific cardinality. Adding a third north adapter would have broken edge routing because no `north-2` existed.

This directly contradicts the hexagonal-architecture metaphor the visualization is meant to express: **four sides of a hexagon, one per port category**.

### D2. North adapters rendered east of their handles

`NORTH_ADAPTER_X_OFFSET` was `330`. On a 500px hex with 180px-wide adapters, centered placement requires offset `(500 − 180) / 2 = 160`. The `330` offset placed every north adapter's left edge 170px east of the hex centerline, and — after D1's index-based handles were introduced — neither adapter ever aligned with its assigned `north-0` or `north-1` handle regardless of the offset value.

### D3. Bounded context drifted from its compass satellites

`calculateElkLayout` in `useCanvasState.ts` preserved hardcoded generator positions for root-level adapters/ports but let ELK reposition the bounded context. The generator places adapters and ports at fixed offsets relative to `hexX`/`hexY` computed from `LAYOUT_CONFIG`; ELK's `layered` algorithm with root-level `getPartitionLane` assignment placed the hex at an arbitrary Lane 3 position that had no relation to those offsets. Result: the hex and its satellites could (and did) detach whenever layout was recomputed.

### D4. Clean-up button was effectively a no-op

`handleClearCanvasLayout` cleared persisted positions from IndexedDB, then re-ran ELK on **current store nodes** — which still carried any user-dragged positions and preserved hardcoded adapter/port positions unchanged through `calculateElkLayout`. In practice nothing visibly changed. The button's label implied "reset to canonical layout" but the implementation was "re-run ELK without discarding user edits".

## Root Causes

| Defect | Root cause                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1     | Handle count was determined by current adapter cardinality, not by the four-sided domain model                                                               |
| D2     | `NORTH_ADAPTER_X_OFFSET` was tuned for an earlier hex dimension and never re-centered against the 500px `ROOT_HEX_DIMENSION`                                 |
| D3     | `calculateElkLayout` anchored only leaf compass nodes but not their anchor hex — ELK and the generator wrote to disjoint position spaces for sibling nodes   |
| D4     | Clean-up reused closure references to the store graph instead of calling the same regenerate-from-`wizardData` path that `loadGraph` uses on manifest change |

## Fix

### F1. Four handles, one per compass side

**`apps/web/features/hexagon-canvas/BoundedContext.tsx:436-471`**

Collapsed five handles into four:

- `north` (type=target, top-center) — all driving adapters converge here
- `south` (type=source, bottom-center) — all driven adapters converge here
- `west` (type=target, left-center) — all inbound ports converge here (unchanged)
- `east` (type=source, right-center) — all outbound ports converge here (unchanged)

Added an explanatory docblock tying handle identity to hexagonal-architecture roles. Multiple adapters or ports on a single side now stack outside the hex and their edges converge on the shared compass handle — mirroring how east/west ports already worked.

### F2. Adapter x centered on hex midline

**`packages/visualization/.../generate-bounded-context-nodes.ts:217-270`**

Replaced per-index fractional offsets (introduced in an intermediate fix) with a single centered computation:

```ts
const adapterX = hexX + hexDimension / 2 - LAYOUT_CONFIG.ADAPTER_NODE_WIDTH / 2;
```

Adapters stack vertically using existing `NORTH_OFFSET_STEP` / `SOUTH_OFFSET_STEP` values and all connect to the single `north` or `south` handle via `targetHandle: 'north'` / `sourceHandle: 'south'`. Removed `NORTH_ADAPTER_X_OFFSET`, `SOUTH_ADAPTER_X_OFFSET`, `NORTH_HANDLE_X_FRACTIONS`, and `SOUTH_HANDLE_X_FRACTIONS` from `config.ts`. Added `ADAPTER_NODE_WIDTH: 180` as an explicit constant (matches the default in `useElkLayout.ts`).

### F3. Anchor the bounded context

**`apps/web/features/hexagon-canvas/hooks/useCanvasState.ts:128-145`**

Extended the ELK position-discard policy from `isRootAdapterOrPort` to `isRootAdapterOrPort || isBoundedContext`. The bounded context now keeps its generator-produced position. ELK continues to determine positions of children **inside** the hex (domain, usecases, entities, use-cases) — this is the workload ELK handles well. The root-level layered/partitioning pass still runs but its output for root compass nodes is now discarded entirely, so the layout is deterministic and the hex cannot drift from its satellites.

### F4. Clean-up regenerates from wizardData

**`apps/web/features/hexagon-canvas/hooks/useCanvasState.ts`**

Three edits:

1. Extracted `regenerateGraphFromWizard` helper that reproduces the generate-and-compile logic previously inlined in `loadGraph`.
2. Rewrote `handleClearCanvasLayout`:
   - clear persistence
   - regenerate canonical nodes/edges from `wizardData`
   - run ELK on the fresh graph
   - `setGraph` with the result
   - fall back to recalculating the store graph only when `wizardData` is unavailable (e.g., projectId-only flows)
3. Clarified docblock distinguishing `handleClearCanvasLayout` (Clean-up — canonical reset) from `recalculateLayout` (re-run ELK, preserve edits).

## Design Decisions

### DD1. ELK owns the interior, not the perimeter

ELK's `layered` algorithm is well-suited to positioning nodes along a dependency flow. It is poorly suited to four-quadrant compass placement because `getPartitionLane` maps north and south onto the same horizontal-lane axis as west and east. Rather than fight ELK's semantics, we draw a boundary: **ELK positions children inside the bounded context; the generator positions the bounded context and its compass satellites**. This matches the architectural narrative of hexagonal-architecture diagrams (compass is external, domain internals are organizational).

### DD2. One handle per side is a domain invariant

The number of handles on a bounded context is not a rendering concern — it is a direct expression of the four port categories in hexagonal architecture. Multiple adapters/ports per category stack outside the hex and converge on the single compass handle. This keeps the visual grammar consistent across all four sides and makes the shape scale naturally: adding a fifth south adapter requires zero changes to `BoundedContext.tsx`.

### DD3. Clean-up regenerates; Recalculate preserves

Clean-up and Recalculate were previously implemented as near-duplicate functions. They now serve distinct purposes:

- `handleClearCanvasLayout` (UI: Clean-up) → discard user edits, regenerate canonical graph, run ELK
- `recalculateLayout` → keep current graph, re-run ELK on it

## Files Changed

| File                                                                                   | Purpose                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/web/features/hexagon-canvas/BoundedContext.tsx`                                  | Unified handles (F1)                                             |
| `apps/web/features/hexagon-canvas/hooks/useCanvasState.ts`                             | Anchored bounded context (F3), regenerate Clean-up (F4)          |
| `packages/visualization/.../hexagonal-map-generator/config.ts`                         | Removed per-index fraction constants, added `ADAPTER_NODE_WIDTH` |
| `packages/visualization/.../hexagonal-map-generator/generate-bounded-context-nodes.ts` | Centered adapter x, unified handle IDs (F2)                      |
| `packages/visualization/.../hexagonal-map-generator/generate-hexagonal-context-map.ts` | Quote-style normalization, dropped `monorepo-boundary` container |

## Verification

| Check                                                 | Result                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| `yarn build`                                          | ✓ 34/34 packages                                 |
| `yarn typecheck`                                      | ✓ 57/57 tasks                                    |
| `yarn lint` (ESLint + `lint:arch`)                    | ✓ `Architecture is compliant with manifest.yaml` |
| Visual — 4 handles per side                           | ✓ confirmed                                      |
| Visual — north adapters centered above hex            | ✓ confirmed                                      |
| Visual — south adapters centered below hex            | ✓ confirmed                                      |
| Visual — Clean-up snaps graph to canonical layout     | ✓ confirmed                                      |
| Visual — hex stays anchored to its compass satellites | ✓ confirmed                                      |

## Follow-up

### Minor

- `useElkLayout.ts:getPartitionLane` still contains the north↔west / south↔east lane-conflation logic. It is now inert for compass nodes (their positions are discarded downstream) but remains misleading to future readers. A no-op refactor to document this dormancy, or remove compass-side branches entirely, would improve clarity. Non-urgent.
- `NORTH_HANDLE_X_FRACTIONS` / `SOUTH_HANDLE_X_FRACTIONS` lived briefly in `config.ts` during an intermediate fix (2026-04-29 morning) and have been removed. If any external code imported them, they will need updating — grep shows no consumers inside the repo.

### None required

- No architecture manifest changes.
- No port/adapter contract changes.
- No published-language surface changes in `@hexagen/visualization`. The generator output shape (`HexagonNode` with `side`) is unchanged; only coordinate computation was rewritten.
