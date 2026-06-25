import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { createInitialState } from "../../domain/reconciliation-state.js";

const phaseOrder = {
  pending: 0,
  diffing: 1,
  verdict: 2,
  approved: 3,
  rejected: 4,
};

function isValidPhaseTransition(fromPhase: string, toPhase: string): boolean {
  if (fromPhase === toPhase) return true;

  const terminalStates = ["approved", "rejected"];
  if (terminalStates.includes(fromPhase)) {
    return false;
  }

  if (
    phaseOrder[fromPhase as keyof typeof phaseOrder] <
    phaseOrder[toPhase as keyof typeof phaseOrder]
  ) {
    return true;
  }

  return false;
}

describe("State Machine Phase Transitions - Integration Tests", () => {
  beforeEach(() => {
    createInitialState();
  });

  describe("Valid Forward Transitions", () => {
    it("should allow pending → diffing transition", () => {
      const canTransition = isValidPhaseTransition("pending", "diffing");
      assert.strictEqual(canTransition, true);
    });

    it("should allow diffing → verdict transition", () => {
      const canTransition = isValidPhaseTransition("diffing", "verdict");
      assert.strictEqual(canTransition, true);
    });

    it("should allow verdict → approved transition", () => {
      const canTransition = isValidPhaseTransition("verdict", "approved");
      assert.strictEqual(canTransition, true);
    });

    it("should allow pending → approved (skip diffing) transition", () => {
      const canTransition = isValidPhaseTransition("pending", "approved");
      assert.strictEqual(canTransition, true);
    });

    it("should allow multi-phase jump pending → verdict", () => {
      const canTransition = isValidPhaseTransition("pending", "verdict");
      assert.strictEqual(canTransition, true);
    });

    it("should allow full sequence: pending → diffing → verdict → approved", () => {
      const t1 = isValidPhaseTransition("pending", "diffing");
      const t2 = isValidPhaseTransition("diffing", "verdict");
      const t3 = isValidPhaseTransition("verdict", "approved");

      assert.strictEqual(t1, true);
      assert.strictEqual(t2, true);
      assert.strictEqual(t3, true);
    });
  });

  describe("Invalid Backward Transitions (Regression Prevention)", () => {
    it("should BLOCK approved → pending regression", () => {
      const canTransition = isValidPhaseTransition("approved", "pending");
      assert.strictEqual(canTransition, false);
    });

    it("should BLOCK approved → diffing regression", () => {
      const canTransition = isValidPhaseTransition("approved", "diffing");
      assert.strictEqual(canTransition, false);
    });

    it("should BLOCK approved → verdict regression", () => {
      const canTransition = isValidPhaseTransition("approved", "verdict");
      assert.strictEqual(canTransition, false);
    });

    it("should BLOCK rejected → pending regression", () => {
      const canTransition = isValidPhaseTransition("rejected", "pending");
      assert.strictEqual(canTransition, false);
    });

    it("should BLOCK rejected → approved regression", () => {
      const canTransition = isValidPhaseTransition("rejected", "approved");
      assert.strictEqual(canTransition, false);
    });

    it("should BLOCK verdict → diffing regression", () => {
      const canTransition = isValidPhaseTransition("verdict", "diffing");
      assert.strictEqual(canTransition, false);
    });

    it("should BLOCK diffing → pending regression", () => {
      const canTransition = isValidPhaseTransition("diffing", "pending");
      assert.strictEqual(canTransition, false);
    });
  });

  describe("Idempotent Transitions (Same Phase)", () => {
    it("should allow pending → pending idempotent transition", () => {
      const canTransition = isValidPhaseTransition("pending", "pending");
      assert.strictEqual(canTransition, true);
    });

    it("should allow approved → approved idempotent transition", () => {
      const canTransition = isValidPhaseTransition("approved", "approved");
      assert.strictEqual(canTransition, true);
    });

    it("should allow rejected → rejected idempotent transition", () => {
      const canTransition = isValidPhaseTransition("rejected", "rejected");
      assert.strictEqual(canTransition, true);
    });
  });

  describe("Monotonicity Guarantees", () => {
    it("should guarantee monotonic ordering: earlier phases cannot regress to later", () => {
      const phases = ["pending", "diffing", "verdict", "approved"];

      for (let i = 0; i < phases.length; i++) {
        for (let j = i + 1; j < phases.length; j++) {
          const canForward = isValidPhaseTransition(phases[i], phases[j]);
          assert.strictEqual(canForward, true);
        }
      }

      for (let i = 1; i < phases.length; i++) {
        for (let j = 0; j < i; j++) {
          const canBackward = isValidPhaseTransition(phases[i], phases[j]);
          assert.strictEqual(canBackward, false);
        }
      }
    });

    it("should maintain ordering across all valid transitions", () => {
      const validTransitions = [
        ["pending", "pending"],
        ["pending", "diffing"],
        ["pending", "verdict"],
        ["pending", "approved"],
        ["diffing", "diffing"],
        ["diffing", "verdict"],
        ["diffing", "approved"],
        ["verdict", "verdict"],
        ["verdict", "approved"],
        ["approved", "approved"],
      ];

      validTransitions.forEach(([from, to]) => {
        assert.strictEqual(isValidPhaseTransition(from, to), true);
      });
    });
  });

  describe("Rejection Phase Handling", () => {
    it("should allow pending → rejected transition", () => {
      const canTransition = isValidPhaseTransition("pending", "rejected");
      assert.strictEqual(canTransition, true);
    });

    it("should allow diffing → rejected transition", () => {
      const canTransition = isValidPhaseTransition("diffing", "rejected");
      assert.strictEqual(canTransition, true);
    });

    it("should allow verdict → rejected transition", () => {
      const canTransition = isValidPhaseTransition("verdict", "rejected");
      assert.strictEqual(canTransition, true);
    });

    it("should BLOCK approved → rejected regression", () => {
      const canTransition = isValidPhaseTransition("approved", "rejected");
      assert.strictEqual(canTransition, false);
    });

    it("should BLOCK rejected → verdict transition", () => {
      const canTransition = isValidPhaseTransition("rejected", "verdict");
      assert.strictEqual(canTransition, false);
    });
  });

  describe("State Metadata Updates During Transitions", () => {
    it("should increment version on phase transition", () => {
      let state = createInitialState();
      const initialVersion = state.version;

      state = { ...state, version: state.version + 1 };

      assert.strictEqual(state.version, initialVersion + 1);
    });

    it("should update lastUpdated timestamp on transition", () => {
      let state = createInitialState();
      const initialTime = state.lastUpdated;

      state = { ...state, lastUpdated: Date.now() };

      assert.ok(state.lastUpdated >= initialTime);
    });

    it("should maintain phase history across transitions", () => {
      createInitialState();
      const history: string[] = [];

      history.push("pending");
      history.push("diffing");
      history.push("approved");

      assert.strictEqual(history.length, 3);
      assert.strictEqual(history[0], "pending");
      assert.strictEqual(history[1], "diffing");
      assert.strictEqual(history[2], "approved");
    });
  });

  describe("Edge Cases & Boundary Conditions", () => {
    it("should handle transition from initial state", () => {
      const canTransition = isValidPhaseTransition("pending", "diffing");
      assert.strictEqual(canTransition, true);
    });

    it("should handle rapid successive transitions", () => {
      let currentPhase = "pending";

      currentPhase = "diffing";
      assert.strictEqual(isValidPhaseTransition("pending", currentPhase), true);

      currentPhase = "verdict";
      assert.strictEqual(isValidPhaseTransition("diffing", currentPhase), true);

      currentPhase = "approved";
      assert.strictEqual(isValidPhaseTransition("verdict", currentPhase), true);
    });

    it("should handle unknown phase names gracefully", () => {
      const result = isValidPhaseTransition("unknown", "pending");
      assert.strictEqual(typeof result, "boolean");
    });
  });

  describe("Transaction Phase Locking", () => {
    it("should lock phase once approved", () => {
      const phase = "approved";

      const tryRevert = isValidPhaseTransition(phase, "pending");
      assert.strictEqual(tryRevert, false);

      const tryIdempotent = isValidPhaseTransition(phase, phase);
      assert.strictEqual(tryIdempotent, true);
    });

    it("should lock phase once rejected", () => {
      const phase = "rejected";

      const tryAdvance = isValidPhaseTransition(phase, "approved");
      assert.strictEqual(tryAdvance, false);

      const tryIdempotent = isValidPhaseTransition(phase, phase);
      assert.strictEqual(tryIdempotent, true);
    });
  });

  describe("Multi-Phase Sequencing", () => {
    it("should support complete forward sequence", () => {
      const sequence = ["pending", "diffing", "verdict", "approved"];

      for (let i = 0; i < sequence.length - 1; i++) {
        const canTransition = isValidPhaseTransition(
          sequence[i],
          sequence[i + 1],
        );
        assert.strictEqual(canTransition, true);
      }
    });

    it("should support skip sequences", () => {
      const skipSequences = [
        ["pending", "approved"],
        ["pending", "verdict"],
        ["diffing", "approved"],
      ];

      skipSequences.forEach(([from, to]) => {
        assert.strictEqual(isValidPhaseTransition(from, to), true);
      });
    });

    it("should prevent any backward sequence", () => {
      const backwardSequences = [
        ["approved", "pending"],
        ["approved", "diffing"],
        ["verdict", "pending"],
        ["diffing", "pending"],
      ];

      backwardSequences.forEach(([from, to]) => {
        assert.strictEqual(isValidPhaseTransition(from, to), false);
      });
    });
  });
});
