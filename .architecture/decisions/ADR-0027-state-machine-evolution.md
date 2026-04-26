# ADR-0027: State Machine Evolution — Monotonic to DAG Extensibility

**Date:** 2026-04-26  
**Status:** 📋 Proposed  
**Supersedes:** None  
**Superseded By:** None  
**Drivers:** Future extensibility for pause/resume, conditional branching, rollback, and parallel pipeline support  
**Related:** Phase B-3 reconciliation engine; `MonotonicStatePromoterAdapter`; `PromoteStatePort`

---

## Problem Statement

### Current Design: Linear Monotonic State Machine

The reconciliation engine (Phase B-3) implements a strict monotonic state machine:

```
pending ──→ diffing ──→ verdict ──→ approved (terminal)
                                 └─→ rejected (terminal)
```

**Implementation Details:**

- **State Phases:** `ReconciliationPhase = "pending" | "diffing" | "verdict" | "approved" | "rejected"`
- **Enforcement:** `MonotonicStatePromoterAdapter` implements `PromoteStatePort` with rank-based ordering
- **Invariant:** `targetRank > currentRank` (no backward transitions allowed)
- **Terminal States:** `approved` and `rejected` clear `pendingVerdicts`

**Current Strengths:**

✅ Simple, predictable flow  
✅ Prevents invalid state combinations  
✅ Sufficient for Phase B-3 MVP scope  
✅ Easy to reason about and test

### Emerging Limitations

As future phases consider new reconciliation workflows, the monotonic constraint becomes restrictive:

1. **No Pause/Resume:** A reconciliation cannot pause at `diffing`, yield to user input, then resume from same state
2. **No Conditional Branching:** Cannot skip `diffing` if change set is empty, or conditionally skip `verdict` if no conflicts
3. **No Rollback Re-Entry:** `rejected` reconciliations cannot be retried from `pending` without external state reset
4. **No Parallel Pipelines:** Cannot support independent reconciliation streams converging at a merge point
5. **No Cycles:** Terminal states are truly terminal; recovery requires creating a new reconciliation
6. **Testing Complexity:** Edge cases around terminal state transitions cannot be exercised

### Why Linearize Now?

Today's MVP doesn't require these features. However, documenting a **non-breaking migration path** to DAG-based state machines now enables:

- **Future Teams:** Clear extension points without rearchitecting core engine
- **Backward Compatibility:** Linear adapter can coexist alongside DAG adapter during transition
- **Testability:** Flexibility to model complex scenarios (pause, resume, parallel branches)
- **Evolvability:** Foundation for reconciliation workflows that deviate from happy-path linearity

---

## Decision

**We adopt a phased migration strategy that:**

1. **Phase 0 (Current):** Preserve `MonotonicStatePromoterAdapter` unchanged; all current tests pass
2. **Phase E (Future):** Implement `DAGStatePromoterAdapter` alongside linear adapter; add configuration switch
3. **Phase F (Future):** Deprecate linear adapter; migrate all pipelines to DAG; DAG becomes authoritative

**This keeps the current MVP intact while establishing a clear, low-risk path to extensibility.**

---

## Current Design Deep-Dive

### State Inference Logic

```typescript
// packages/reconciliation-engine/src/infrastructure/adapters/monotonic-state-promoter.adapter.ts

const PHASE_ORDER: ReconciliationPhase[] = [
  "pending",     // Initialized; no changes detected
  "diffing",     // Change analysis in progress (version > 0)
  "verdict",     // Conflicts detected; awaiting user verdict
  "approved",    // No conflicts; terminal
  "rejected",    // Conflicts remain after verdict; terminal
];

const PHASE_RANK = new Map(PHASE_ORDER.map((phase, i) => [phase, i]));

promoteToPhase(state, targetPhase): ReconciliationState {
  const currentRank = PHASE_RANK.get(this.inferPhase(state));
  const targetRank = PHASE_RANK.get(targetPhase);

  if (targetRank <= currentRank) {
    return state; // No-op: reject backward transition
  }

  return {
    ...state,
    version: state.version + 1,
    lastUpdated: Date.now(),
    isStable: targetPhase === "approved" || targetPhase === "rejected",
    pendingVerdicts: isTerminal(targetPhase) ? [] : state.pendingVerdicts,
  };
}

inferPhase(state): ReconciliationPhase {
  if (state.pendingVerdicts.length === 0 && state.isStable) {
    return state.conflictCount === 0 ? "approved" : "rejected";
  }
  if (state.pendingVerdicts.length > 0) return "verdict";
  if (state.version > 0) return "diffing";
  return "pending";
}
```

**Key Observation:** Phase is inferred from state properties, not explicitly stored. This makes rank-checking straightforward but inflexible.

### ReconciliationState Structure

```typescript
export type ReconciliationState = {
  version: number; // Incremented on each transition
  lastUpdated: number; // Timestamp
  isStable: boolean; // true if in terminal state (approved/rejected)
  conflictCount: number; // Conflict count (used to determine approved vs rejected)
  pendingVerdicts: string[]; // Verdict IDs awaiting resolution
};
```

**Constraint for Migration:** Any new state machine must preserve these properties to maintain backward compatibility.

---

## Proposed DAG Design (Future)

### Core Concept

Replace rank-based ordering with an explicit directed acyclic graph (DAG) of state nodes and transitions.

```
                 ┌─→ diffing ─────┐
                 │                 │
pending (start) ─┤                 ├─→ verdict ──┬─→ approved (terminal)
                 │                 │              │
                 └─→ [skip] ───────┘              └─→ rejected ──┐
                                                         │
                                                    [retry] │
                                                         │
                                                  pending (re-entry)
```

**Node Types:**

- **Regular Node:** `pending`, `diffing`, `verdict`, `approved`, `rejected`
- **Decision Node:** `[skip]` (conditional branch based on conflict count)
- **Retry Loop:** `rejected` → `pending` (user can trigger re-reconciliation)

### Data Structures

#### StateNode

```typescript
interface StateNode {
  id: ReconciliationPhase;
  label: string;
  terminal: boolean;
  metadata?: {
    retryable?: boolean; // Can re-enter from rejected
    pausable?: boolean; // Can suspend in this state
    parallel?: boolean; // Can fork into multiple branches
    skipCondition?: (state: ReconciliationState) => boolean;
  };
}
```

#### StateEdge

```typescript
interface StateEdge {
  from: ReconciliationPhase;
  to: ReconciliationPhase;
  label?: string;
  guard?: (state: ReconciliationState) => boolean; // Predicate: allow transition?
  onTransition?: (state: ReconciliationState) => ReconciliationState; // Side effect
  metadata?: {
    isRetry?: boolean; // Marks retry path
    priority?: number; // For multi-target edges
  };
}
```

#### StateGraph

```typescript
interface StateGraph {
  nodes: Map<ReconciliationPhase, StateNode>;
  edges: StateEdge[];
  startNode: ReconciliationPhase;
  terminalNodes: Set<ReconciliationPhase>;

  // Query methods
  findPath(
    from: ReconciliationPhase,
    to: ReconciliationPhase,
  ): StateEdge[] | null;
  getSuccessors(phase: ReconciliationPhase): ReconciliationPhase[];
  getValidTransitions(
    phase: ReconciliationPhase,
    state: ReconciliationState,
  ): StateEdge[];
}
```

### DAGStatePromoterAdapter Implementation

```typescript
export class DAGStatePromoterAdapter implements PromoteStatePort {
  private graph: StateGraph;

  constructor(graph: StateGraph) {
    this.graph = graph;
  }

  promoteToPhase(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): ReconciliationState {
    const currentPhase = this.inferPhase(state);

    // Find valid path from current to target
    const path = this.graph.findPath(currentPhase, targetPhase);
    if (!path || path.length === 0) {
      // No valid transition; return state unchanged
      return state;
    }

    // Apply each edge's guard and transition in sequence
    let result = state;
    for (const edge of path) {
      // Check guard
      if (edge.guard && !edge.guard(result)) {
        return result; // Guard failed; stop here
      }

      // Apply transition side effect
      if (edge.onTransition) {
        result = edge.onTransition(result);
      }

      // Increment version (consistent with current adapter)
      result = {
        ...result,
        version: result.version + 1,
        lastUpdated: Date.now(),
      };
    }

    // Update terminal state if target is terminal
    if (this.graph.terminalNodes.has(targetPhase)) {
      result.isStable = true;
      result.pendingVerdicts = [];
    }

    return result;
  }

  private inferPhase(state: ReconciliationState): ReconciliationPhase {
    // Same logic as MonotonicStatePromoterAdapter
    if (state.pendingVerdicts.length === 0 && state.isStable) {
      return state.conflictCount === 0 ? "approved" : "rejected";
    }
    if (state.pendingVerdicts.length > 0) return "verdict";
    if (state.version > 0 && state.pendingVerdicts.length === 0)
      return "diffing";
    return "pending";
  }
}
```

### Example: DAG with Retry Logic

```typescript
const reconciliationGraph: StateGraph = {
  nodes: new Map([
    ["pending", { id: "pending", label: "Pending", terminal: false }],
    ["diffing", { id: "diffing", label: "Diffing", terminal: false }],
    ["verdict", { id: "verdict", label: "Verdict", terminal: false }],
    ["approved", { id: "approved", label: "Approved", terminal: true }],
    [
      "rejected",
      {
        id: "rejected",
        label: "Rejected",
        terminal: true,
        metadata: { retryable: true },
      },
    ],
  ]),

  edges: [
    // Normal forward path
    { from: "pending", to: "diffing", label: "Detect changes" },
    { from: "diffing", to: "verdict", label: "Conflicts found" },
    {
      from: "verdict",
      to: "approved",
      label: "Resolve",
      guard: (state) => state.conflictCount === 0,
    },
    {
      from: "verdict",
      to: "rejected",
      label: "Unresolved",
      guard: (state) => state.conflictCount > 0,
    },

    // Retry path (future extension)
    {
      from: "rejected",
      to: "pending",
      label: "Retry",
      onTransition: (state) => ({
        ...state,
        conflictCount: 0,
        pendingVerdicts: [],
      }),
      metadata: { isRetry: true },
    },
  ],

  startNode: "pending",
  terminalNodes: new Set(["approved", "rejected"]),

  findPath(from, to) {
    // Breadth-first search from `from` to `to`
    if (from === to) return [];

    const queue = [[from]];
    const visited = new Set([from]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      for (const edge of this.edges.filter((e) => e.from === current)) {
        if (edge.to === to) {
          return this.edges.filter((e) => e.from === current && e.to === to);
        }

        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push([...path, edge.to]);
        }
      }
    }

    return null; // No path found
  },

  getSuccessors(phase) {
    return this.edges.filter((e) => e.from === phase).map((e) => e.to);
  },

  getValidTransitions(phase, state) {
    return this.edges
      .filter((e) => e.from === phase)
      .filter((e) => !e.guard || e.guard(state));
  },
};
```

---

## Migration Strategy (Three Phases)

### Phase 0: Current Implementation (No Changes)

**Status:** ✅ In Production  
**Action:** None required

- `MonotonicStatePromoterAdapter` remains unchanged
- All current tests pass
- Current MVP behavior preserved indefinitely

**Code Location:** `packages/reconciliation-engine/src/infrastructure/adapters/monotonic-state-promoter.adapter.ts`

---

### Phase E: DAG Implementation (Future, ~3–4h effort)

**Trigger:** Future feature request for pause/resume, retry, or conditional branching

**Actions:**

1. **Create DAG Types** (`packages/reconciliation-engine/src/domain/state-graph.ts`)
   - `StateNode`, `StateEdge`, `StateGraph` interfaces
   - Graph construction helpers

2. **Implement DAGStatePromoterAdapter** (`packages/reconciliation-engine/src/infrastructure/adapters/dag-state-promoter.adapter.ts`)
   - Implements `PromoteStatePort` (same interface)
   - Path-finding algorithm (BFS or Dijkstra)
   - Guard evaluation and side-effect application

3. **Create Default DAG** (`packages/reconciliation-engine/src/infrastructure/graphs/default-reconciliation-graph.ts`)
   - Matches current linear behavior
   - Enables future retry loops and branching

4. **Add Configuration** (`packages/reconciliation-engine/src/wiring.ts`)
   - New config flag: `statePromotionMode: "monotonic" | "dag"`
   - Factory function to select adapter based on config

5. **Unit Tests** (`packages/reconciliation-engine/src/__tests__/dag-state-promoter.adapter.test.ts`)
   - Graph construction
   - Path finding
   - Guard evaluation
   - Side-effect ordering
   - No-path scenarios

**Manifest Update:**

```yaml
- name: DAGStatePromoterAdapter
  type: Adapter (secondary, for state machine evolution)
  responsible-for:
    - Path finding in state graph
    - Guard evaluation
    - Multi-edge transitions
  is-port-implementation-of:
    - PromoteStatePort
  depends-on:
    - StateGraph
```

Run: `yarn lint:arch` after manifest edit

**Build & Test:**

```bash
yarn workspace @hexagen/reconciliation-engine build
yarn workspace @hexagen/reconciliation-engine test
```

---

### Phase F: Full Migration (Future, ~2–3h effort)

**Trigger:** Decision to retire linear adapter and standardize on DAG

**Actions:**

1. **Data Migration:** Script to convert all persisted `ReconciliationState` records
   - No change needed (DAG uses same state structure)

2. **Pipeline Update:** Flip default config
   - `statePromotionMode: "dag"` becomes default
   - `MonotonicStatePromoterAdapter` marked as deprecated

3. **Deprecation Warning:** Add runtime log when linear adapter is used
   - Informs downstream consumers to migrate

4. **Remove Linear Adapter:** Delete `MonotonicStatePromoterAdapter` (safe after deprecation period)

5. **Full Test Suite:** Verify all reconciliation tests pass with DAG adapter

**Cleanup:**

```bash
rm packages/reconciliation-engine/src/infrastructure/adapters/monotonic-state-promoter.adapter.ts
rm packages/reconciliation-engine/src/__tests__/monotonic-state-promoter.adapter.test.ts
```

---

## Backward Compatibility

### No Breaking Changes During Migration

**PromoteStatePort remains unchanged:**

```typescript
export interface PromoteStatePort {
  promoteToPhase(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): ReconciliationState;
}
```

Both `MonotonicStatePromoterAdapter` and `DAGStatePromoterAdapter` implement the same contract. Consumers don't care which adapter is wired; behavior is identical during linear operation.

**ReconciliationState remains unchanged:**

All state is preserved; no schema migration required.

**Configuration-Driven Switching:**

Factory pattern enables easy flipping between adapters:

```typescript
export function createPromoteStateAdapter(config: {
  statePromotionMode: "monotonic" | "dag";
}): PromoteStatePort {
  if (config.statePromotionMode === "dag") {
    return new DAGStatePromoterAdapter(defaultReconciliationGraph);
  }
  return new MonotonicStatePromoterAdapter();
}
```

---

## Testing Strategy

### Phase 0 (Current)

- Existing tests for `MonotonicStatePromoterAdapter` remain valid
- No new tests required

### Phase E (DAG Implementation)

**Unit Tests:**

```typescript
describe("DAGStatePromoterAdapter", () => {
  let adapter: DAGStatePromoterAdapter;
  let graph: StateGraph;

  beforeEach(() => {
    graph = defaultReconciliationGraph;
    adapter = new DAGStatePromoterAdapter(graph);
  });

  describe("promoteToPhase", () => {
    test("allows valid forward transitions", () => {
      const state = createInitialState();
      const result = adapter.promoteToPhase(state, "diffing");
      expect(result.version).toBe(1);
    });

    test("rejects invalid transitions", () => {
      const state = createInitialState();
      const result = adapter.promoteToPhase(state, "verdict");
      expect(result.version).toBe(0); // No-op
    });

    test("evaluates guards before transitioning", () => {
      const state = { ...createInitialState(), conflictCount: 5 };
      const result = adapter.promoteToPhase(state, "approved");
      // Should not reach approved due to guard (conflicts > 0)
      expect(result.isStable).toBe(false);
    });

    test("applies side effects during multi-edge paths", () => {
      const state = createInitialState();
      const result = adapter.promoteToPhase(state, "approved");
      // Verify all intermediate states applied correctly
      expect(result.version).toBeGreaterThan(0);
    });
  });

  describe("graph pathfinding", () => {
    test("finds path from start to terminal node", () => {
      const path = graph.findPath("pending", "approved");
      expect(path).not.toBeNull();
      expect(path?.length).toBeGreaterThan(0);
    });

    test("returns null for unreachable nodes", () => {
      // Add a disconnected node to test graph
      const disconnectedGraph = { ...graph };
      const path = disconnectedGraph.findPath("pending", "orphaned");
      expect(path).toBeNull();
    });

    test("handles retry loops (rejected → pending)", () => {
      const path = graph.findPath("rejected", "approved");
      expect(path).not.toBeNull(); // Should find retry path
    });
  });
});
```

**Integration Tests:**

```typescript
describe("DAGStatePromoterAdapter integration", () => {
  test("current monotonic behavior is preserved", () => {
    const linearAdapter = new MonotonicStatePromoterAdapter();
    const dagAdapter = new DAGStatePromoterAdapter(defaultReconciliationGraph);

    let state = createInitialState();

    // Test both adapters produce identical results for linear path
    for (const phase of ["diffing", "verdict", "approved"]) {
      const linear = linearAdapter.promoteToPhase(state, phase as any);
      const dag = dagAdapter.promoteToPhase(state, phase as any);

      expect(dag).toEqual(linear);
      state = dag;
    }
  });
});
```

**Property-Based Tests:**

```typescript
import { fc } from "fast-check";

describe("DAGStatePromoterAdapter properties", () => {
  test("version always increments on valid transition", () => {
    fc.assert(
      fc.property(fc.object(), (state) => {
        const dag = new DAGStatePromoterAdapter(defaultReconciliationGraph);
        const result = dag.promoteToPhase(
          { ...state, version: 100, isStable: false },
          "diffing",
        );
        return result.version > 100;
      }),
    );
  });

  test("terminal nodes have empty pendingVerdicts", () => {
    fc.assert(
      fc.property(fc.object(), (state) => {
        const dag = new DAGStatePromoterAdapter(defaultReconciliationGraph);
        const approved = dag.promoteToPhase(state, "approved");
        const rejected = dag.promoteToPhase(state, "rejected");

        return (
          approved.pendingVerdicts.length === 0 &&
          rejected.pendingVerdicts.length === 0
        );
      }),
    );
  });
});
```

### Phase F (Migration)

- Run full reconciliation engine test suite with DAG adapter as default
- Verify end-to-end behavior unchanged
- Monitor deprecation warnings in staging

---

## Diagram: Current vs. Future State Machines

### Current (Monotonic)

```
                          ┌─ Conflict?
                          │
   ┌─ Changes?            │
   │                      │
pending ──→ diffing ──→ verdict ──┤
                                  │
                          ┌───────┘
                          │
                   No ────┴─→ approved ✓
                   │
                   │
                   Yes
                   │
                   └─→ rejected ✗

No backward transitions allowed (rank check enforces this)
Terminal states: approved, rejected
```

### Future (DAG with Extensibility)

```
                         skip (conflict-free path)
                              │
                              ▼
pending ──→ diffing ────┬──────┴──→ verdict ──┬─→ approved ✓
    ▲      (analyze)   │                      │
    │                  └──────────────────────┘
    │
    └────── [retry] ─── rejected ✗
            (future)

Possible extensions:
• Pause/resume: Add "paused" state with edges to/from any phase
• Parallel: Fork from "diffing" into independent analysis paths; merge at "verdict"
• Conditional skip: Guard on diffing→verdict edge (skip if no conflicts)
• Rollback: Add edge rejected→pending with reset side effect
```

---

## Effort & Timeline

| Phase | Task                                | Effort | Dependency            |
| ----- | ----------------------------------- | ------ | --------------------- |
| E1    | Define DAG types & interfaces       | 1h     | None                  |
| E2    | Implement DAGStatePromoterAdapter   | 1.5h   | E1                    |
| E3    | Create default reconciliation graph | 0.5h   | E1, E2                |
| E4    | Add configuration factory           | 0.5h   | E2, E3                |
| E5    | Unit & integration tests            | 1h     | E4                    |
| F1    | Update default config               | 0.25h  | E5                    |
| F2    | Deprecation warnings                | 0.5h   | F1                    |
| F3    | Remove linear adapter               | 0.25h  | F2 (post-deprecation) |
| F4    | Full regression testing             | 1h     | F3                    |

**Total Phase E:** ~4h  
**Total Phase F:** ~2.5h (non-blocking; can occur after MVP release)

---

## Validation Criteria

### Phase E Acceptance

✅ DAG implementation builds without errors  
✅ All new DAG unit tests pass  
✅ Linear behavior preserved: `MonotonicStatePromoterAdapter` tests still pass  
✅ Configuration factory correctly selects between adapters  
✅ Code review approved; no architectural violations  
✅ Full monorepo CI passes: `yarn build && yarn typecheck && yarn test`

### Phase F Acceptance

✅ Default config flipped to DAG; all tests pass  
✅ Deprecation warnings appear in logs  
✅ End-to-end reconciliation tests pass with DAG adapter  
✅ No regressions in reconciliation behavior  
✅ `MonotonicStatePromoterAdapter` safely removed; build still passes

---

## Risks & Mitigations

| Risk                                      | Mitigation                                                  |
| ----------------------------------------- | ----------------------------------------------------------- |
| DAG pathfinding performance degrades      | Use BFS (fast for small graphs); profile before full deploy |
| Guard evaluation causes unexpected no-ops | Comprehensive unit tests; debug logs in adapter             |
| State inference differs between adapters  | Shared `inferPhase` method; ensure identical behavior       |
| Migration breaks persisted state          | State structure unchanged; no migration required            |
| Configuration not respected               | Factory tests; verify correct adapter is wired              |
| Cycles in DAG break infinite loops        | Graph validation: validate no cycles except retry loops     |

---

## Alternatives Considered

### Alternative 1: Refactor to DAG Today

Implement DAG immediately; deprecate linear adapter in Phase B-4.

**Rejected:** Adds 4h work to current critical path. Linear adapter is correct for MVP. DAG is nice-to-have for future extensibility. Delay justifies lower priority.

### Alternative 2: Keep Linear Adapter Forever

Never migrate; build new adapters for each feature (pause, retry, etc.).

**Rejected:** Creates adapter sprawl. Every conditional behavior becomes a new adapter. DAG is the right abstraction; use it once.

### Alternative 3: Embed DAG Logic in MonotonicStatePromoterAdapter

Add DAG fields but use only linear subset.

**Rejected:** Adds complexity to current adapter; worse testing story. Separate adapters via factory is cleaner.

---

## Consequences

### Positive

✅ **Clear Extension Path:** Future features (pause, retry, parallel) have a home without rearchitecting  
✅ **Backward Compatible:** Linear adapter unchanged during Phase E; existing code continues working  
✅ **Testable:** DAG enables property-based testing of state transitions  
✅ **Documented:** This ADR serves as specification for future implementers  
✅ **Low-Risk MVP:** Phase 0 remains stable; no blocking work

### Negative

⚠️ **Future Complexity:** DAG adapter will require more careful maintenance (pathfinding, guard ordering)  
⚠️ **Testing Burden:** New adapter requires new test suite (mitigated by property-based tests)  
⚠️ **Configuration Management:** Must ensure correct adapter is selected (mitigated by factory tests)

---

## Follow-Up Actions

### Immediate (Phase 0)

- ✅ Approve this ADR
- ✅ File Phase E work ticket (link to this ADR)
- ✅ Add link to AGENTS.md reconciliation section

### Before Phase E

- Review graph pathfinding algorithm options (BFS vs. Dijkstra)
- Design deprecation warning message
- Plan stakeholder communication (if Phase F occurs)

### After Phase F

- Monitor production metrics (reconciliation performance, error rates)
- Archive `ADR-0027` as "Complete & Deployed"
- Update AGENTS.md to reference DAG as authoritative state machine

---

## References

- **Current Implementation:** `packages/reconciliation-engine/src/infrastructure/adapters/monotonic-state-promoter.adapter.ts`
- **ReconciliationState:** `packages/reconciliation-engine/src/domain/reconciliation-state.ts`
- **PromoteStatePort:** `packages/reconciliation-engine/src/application/ports/in/promote-state.port.ts`
- **Manifest:** `.architecture/manifest.yaml` (reconciliation-engine package)
- **ADR-0010 & ADR-0011:** AI pipeline architecture (related DAG use case)

---

**Author:** OpenCode / System Architect  
**Approved By:** [Pending]  
**Effective Date:** 2026-04-26
