import { MonotonicStatePromoterAdapter } from "../../../src/infrastructure/adapters/monotonic-state-promoter.adapter.js";
import type { PromoteStatePort } from "../../../src/application/ports/in/promote-state.port.js";
import type { ReconciliationState } from "../../../src/domain/reconciliation-state.js";

describe("MonotonicStatePromoterAdapter", () => {
  let adapter: PromoteStatePort;

  beforeEach(() => {
    adapter = new MonotonicStatePromoterAdapter();
  });

  describe("promoteState", () => {
    it("should increase version by 1", () => {
      const state: ReconciliationState = {
        version: 5,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 3,
        pendingVerdicts: ["v1", "v2", "v3"],
      };
      const newState = adapter.promoteState(state, "v2");
      expect(newState.version).toBe(state.version + 1);
    });

    it("should decrease conflictCount by 1 (but not below 0)", () => {
      let state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 1,
        pendingVerdicts: ["v1"],
      };
      const newState = adapter.promoteState(state, "v1");
      expect(newState.conflictCount).toBe(0);

      state = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 0,
        pendingVerdicts: [],
      };
      // This should throw because verdict is not in pendingVerdicts
      expect(() => adapter.promoteState(state, "v1")).toThrow();
    });

    it("should remove the verdict ID from pendingVerdicts", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 2,
        pendingVerdicts: ["v1", "v2", "v3"],
      };
      const newState = adapter.promoteState(state, "v2");
      expect(newState.pendingVerdicts).toEqual(["v1", "v3"]);
    });

    it("should set isStable to true when pendingVerdicts length <= 1 after promotion", () => {
      let state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 1,
        pendingVerdicts: ["v1"],
      };
      const newState = adapter.promoteState(state, "v1");
      expect(newState.isStable).toBe(true);

      state = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 0,
        pendingVerdicts: [],
      };
      // This should throw because verdict is not in pendingVerdicts
      expect(() => adapter.promoteState(state, "v1")).toThrow();
    });

    it("should update lastUpdated to current time", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 2,
        pendingVerdicts: ["v1", "v2"],
      };
      const newState = adapter.promoteState(state, "v1");
      expect(newState.lastUpdated).toBeGreaterThan(state.lastUpdated);
    });

    it("should throw when state version is negative", () => {
      const state: ReconciliationState = {
        version: -1,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 2,
        pendingVerdicts: ["v1", "v2"],
      };
      expect(() => adapter.promoteState(state, "v1")).toThrow(
        "Reconciliation state version cannot be negative",
      );
    });

    it("should throw when verdictId is not in pendingVerdicts", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 2,
        pendingVerdicts: ["v1", "v2"],
      };
      expect(() => adapter.promoteState(state, "v3")).toThrow(
        "Verdict v3 not found in pending verdicts",
      );
    });
  });
});
