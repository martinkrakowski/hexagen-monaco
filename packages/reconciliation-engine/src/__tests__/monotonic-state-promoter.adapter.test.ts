import { MonotonicStatePromoterAdapter } from "../infrastructure/adapters/monotonic-state-promoter.adapter.js";
import {
  createInitialState,
  addVerdict,
} from "../domain/reconciliation-state.js";
import type { ReconciliationState } from "../domain/reconciliation-state.js";

describe("MonotonicStatePromoterAdapter", () => {
  let adapter: MonotonicStatePromoterAdapter;

  beforeEach(() => {
    adapter = new MonotonicStatePromoterAdapter();
  });

  it("should infer pending phase for state with pending verdicts", () => {
    const state = addVerdict(createInitialState(), "verdict-1");
    state.isStable = false;

    const result = adapter.promoteToPhase(state, "approved");

    expect(result.version).toBeGreaterThan(state.version);
  });

  it("should not allow backward phase transitions", () => {
    const state: ReconciliationState = {
      version: 3,
      lastUpdated: Date.now(),
      isStable: true,
      conflictCount: 0,
      pendingVerdicts: [],
    };

    const result = adapter.promoteToPhase(state, "pending");

    expect(result.version).toBe(state.version);
  });

  it("should add pending verdict to state", () => {
    const state = createInitialState();
    const result = adapter.addPendingVerdict(state, "verdict-1");

    expect(result.pendingVerdicts).toContain("verdict-1");
    expect(result.conflictCount).toBe(1);
    expect(result.isStable).toBe(false);
  });
});
