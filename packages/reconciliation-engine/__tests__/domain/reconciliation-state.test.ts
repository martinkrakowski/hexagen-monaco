import {
  createInitialState,
  promoteState,
  addVerdict,
  ReconciliationState,
} from "../../src/domain/reconciliation-state.js";

describe("ReconciliationState", () => {
  describe("createInitialState", () => {
    it("should create a state with version 0", () => {
      const state = createInitialState();
      expect(state.version).toBe(0);
    });

    it("should create a state with empty pendingVerdicts", () => {
      const state = createInitialState();
      expect(state.pendingVerdicts).toEqual([]);
    });

    it("should create a stable state with zero conflicts", () => {
      const state = createInitialState();
      expect(state.isStable).toBe(true);
      expect(state.conflictCount).toBe(0);
    });
  });

  describe("addVerdict", () => {
    it("should increase version by 1", () => {
      const state: ReconciliationState = {
        version: 5,
        lastUpdated: 1000,
        isStable: true,
        conflictCount: 2,
        pendingVerdicts: ["v1", "v2"],
      };
      const newState = addVerdict(state, "v3");
      expect(newState.version).toBe(state.version + 1);
    });

    it("should increase conflictCount by 1", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 3,
        pendingVerdicts: ["v1"],
      };
      const newState = addVerdict(state, "v2");
      expect(newState.conflictCount).toBe(state.conflictCount + 1);
    });

    it("should add the verdict ID to pendingVerdicts", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 0,
        pendingVerdicts: ["v1"],
      };
      const newState = addVerdict(state, "v2");
      expect(newState.pendingVerdicts).toEqual(["v1", "v2"]);
    });

    it("should set isStable to false", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: true,
        conflictCount: 0,
        pendingVerdicts: [],
      };
      const newState = addVerdict(state, "v1");
      expect(newState.isStable).toBe(false);
    });

    it("should update lastUpdated to current time", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: true,
        conflictCount: 0,
        pendingVerdicts: [],
      };
      const newState = addVerdict(state, "v1");
      expect(newState.lastUpdated).toBeGreaterThan(state.lastUpdated);
    });
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
      const newState = promoteState(state, "v2");
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
      let newState = promoteState(state, "v1");
      expect(newState.conflictCount).toBe(0);

      state = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 0,
        pendingVerdicts: [],
      };
      newState = promoteState(state, "v1"); // verdict not in pending, but we'll test the function's behavior
      // Actually, the function will throw in the adapter, but the domain function doesn't check
      // We are testing the domain function here, which doesn't have the guard.
      // So we expect it to still decrease (but we guard against negative in the adapter).
      // For the domain function, we just test the logic as written.
      expect(newState.conflictCount).toBe(0); // because Math.max(0, -1) = 0
    });

    it("should remove the verdict ID from pendingVerdicts", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 2,
        pendingVerdicts: ["v1", "v2", "v3"],
      };
      const newState = promoteState(state, "v2");
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
      let newState = promoteState(state, "v1");
      expect(newState.isStable).toBe(true);

      state = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 0,
        pendingVerdicts: [],
      };
      newState = promoteState(state, "v1"); // not in pending, but we test the logic
      expect(newState.isStable).toBe(true); // because pendingVerdicts remains [] (length 0 <= 1)
    });

    it("should update lastUpdated to current time", () => {
      const state: ReconciliationState = {
        version: 0,
        lastUpdated: 1000,
        isStable: false,
        conflictCount: 2,
        pendingVerdicts: ["v1", "v2"],
      };
      const newState = promoteState(state, "v1");
      expect(newState.lastUpdated).toBeGreaterThan(state.lastUpdated);
    });
  });

  describe("monotonic version property", () => {
    it("should never decrease version through any sequence of operations", () => {
      let state = createInitialState();
      const versions = [state.version];

      // Add 5 verdicts
      for (let i = 0; i < 5; i++) {
        state = addVerdict(state, `v${i}`);
        versions.push(state.version);
      }

      // Promote 3 verdicts
      for (let i = 0; i < 3; i++) {
        state = promoteState(state, `v${i}`);
        versions.push(state.version);
      }

      // Check that versions are strictly increasing
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1]);
      }
    });
  });
});
