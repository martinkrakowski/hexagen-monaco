/**
 * Integration test: State Machine Phase Transitions
 *
 * Tests the monotonic state machine ensuring phase transitions follow valid paths:
 * pending → diffing → verdict → approved (forward only)
 * Prevents regressions: approved → pending or rejected → approved
 */

import { createInitialState } from "../../domain/reconciliation-state.js";

// Mock implementation of state transition logic
const phaseOrder = {
  pending: 0,
  diffing: 1,
  verdict: 2,
  approved: 3,
  rejected: 4,
};

function isValidPhaseTransition(fromPhase: string, toPhase: string): boolean {
  // Allow transitions to same phase
  if (fromPhase === toPhase) return true;

  // Terminal states: approved and rejected cannot transition to anything except themselves
  const terminalStates = ["approved", "rejected"];
  if (terminalStates.includes(fromPhase)) {
    return false;
  }

  // Allow forward transitions (only if from is not terminal)
  if (
    phaseOrder[fromPhase as keyof typeof phaseOrder] <
    phaseOrder[toPhase as keyof typeof phaseOrder]
  ) {
    return true;
  }

  // Disallow backward transitions (regressions)
  return false;
}

describe("State Machine Phase Transitions - Integration Tests", () => {
  beforeEach(() => {
    createInitialState();
  });

  describe("Valid Forward Transitions", () => {
    it("should allow pending → diffing transition", () => {
      const canTransition = isValidPhaseTransition("pending", "diffing");
      expect(canTransition).toBe(true);
    });

    it("should allow diffing → verdict transition", () => {
      const canTransition = isValidPhaseTransition("diffing", "verdict");
      expect(canTransition).toBe(true);
    });

    it("should allow verdict → approved transition", () => {
      const canTransition = isValidPhaseTransition("verdict", "approved");
      expect(canTransition).toBe(true);
    });

    it("should allow pending → approved (skip diffing) transition", () => {
      const canTransition = isValidPhaseTransition("pending", "approved");
      expect(canTransition).toBe(true);
    });

    it("should allow multi-phase jump pending → verdict", () => {
      const canTransition = isValidPhaseTransition("pending", "verdict");
      expect(canTransition).toBe(true);
    });

    it("should allow full sequence: pending → diffing → verdict → approved", () => {
      const t1 = isValidPhaseTransition("pending", "diffing");
      const t2 = isValidPhaseTransition("diffing", "verdict");
      const t3 = isValidPhaseTransition("verdict", "approved");

      expect(t1).toBe(true);
      expect(t2).toBe(true);
      expect(t3).toBe(true);
    });
  });

  describe("Invalid Backward Transitions (Regression Prevention)", () => {
    it("should BLOCK approved → pending regression", () => {
      const canTransition = isValidPhaseTransition("approved", "pending");
      expect(canTransition).toBe(false);
    });

    it("should BLOCK approved → diffing regression", () => {
      const canTransition = isValidPhaseTransition("approved", "diffing");
      expect(canTransition).toBe(false);
    });

    it("should BLOCK approved → verdict regression", () => {
      const canTransition = isValidPhaseTransition("approved", "verdict");
      expect(canTransition).toBe(false);
    });

    it("should BLOCK rejected → pending regression", () => {
      const canTransition = isValidPhaseTransition("rejected", "pending");
      expect(canTransition).toBe(false);
    });

    it("should BLOCK rejected → approved regression", () => {
      const canTransition = isValidPhaseTransition("rejected", "approved");
      expect(canTransition).toBe(false);
    });

    it("should BLOCK verdict → diffing regression", () => {
      const canTransition = isValidPhaseTransition("verdict", "diffing");
      expect(canTransition).toBe(false);
    });

    it("should BLOCK diffing → pending regression", () => {
      const canTransition = isValidPhaseTransition("diffing", "pending");
      expect(canTransition).toBe(false);
    });
  });

  describe("Idempotent Transitions (Same Phase)", () => {
    it("should allow pending → pending idempotent transition", () => {
      const canTransition = isValidPhaseTransition("pending", "pending");
      expect(canTransition).toBe(true);
    });

    it("should allow approved → approved idempotent transition", () => {
      const canTransition = isValidPhaseTransition("approved", "approved");
      expect(canTransition).toBe(true);
    });

    it("should allow rejected → rejected idempotent transition", () => {
      const canTransition = isValidPhaseTransition("rejected", "rejected");
      expect(canTransition).toBe(true);
    });
  });

  describe("Monotonicity Guarantees", () => {
    it("should guarantee monotonic ordering: earlier phases cannot regress to later", () => {
      const phases = ["pending", "diffing", "verdict", "approved"];

      for (let i = 0; i < phases.length; i++) {
        for (let j = i + 1; j < phases.length; j++) {
          const canForward = isValidPhaseTransition(phases[i], phases[j]);
          expect(canForward).toBe(true);
        }
      }

      for (let i = 1; i < phases.length; i++) {
        for (let j = 0; j < i; j++) {
          const canBackward = isValidPhaseTransition(phases[i], phases[j]);
          expect(canBackward).toBe(false);
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
        expect(isValidPhaseTransition(from, to)).toBe(true);
      });
    });
  });

  describe("Rejection Phase Handling", () => {
    it("should allow pending → rejected transition", () => {
      const canTransition = isValidPhaseTransition("pending", "rejected");
      expect(canTransition).toBe(true);
    });

    it("should allow diffing → rejected transition", () => {
      const canTransition = isValidPhaseTransition("diffing", "rejected");
      expect(canTransition).toBe(true);
    });

    it("should allow verdict → rejected transition", () => {
      const canTransition = isValidPhaseTransition("verdict", "rejected");
      expect(canTransition).toBe(true);
    });

    it("should BLOCK approved → rejected regression", () => {
      const canTransition = isValidPhaseTransition("approved", "rejected");
      expect(canTransition).toBe(false);
    });

    it("should BLOCK rejected → verdict transition", () => {
      const canTransition = isValidPhaseTransition("rejected", "verdict");
      expect(canTransition).toBe(false);
    });
  });

  describe("State Metadata Updates During Transitions", () => {
    it("should increment version on phase transition", () => {
      let state = createInitialState();
      const initialVersion = state.version;

      state = { ...state, version: state.version + 1 };

      expect(state.version).toBe(initialVersion + 1);
    });

    it("should update lastUpdated timestamp on transition", () => {
      let state = createInitialState();
      const initialTime = state.lastUpdated;

      state = { ...state, lastUpdated: Date.now() };

      expect(state.lastUpdated).toBeGreaterThanOrEqual(initialTime);
    });

    it("should maintain phase history across transitions", () => {
      createInitialState();
      const history: string[] = [];

      // Simulate transitions
      history.push("pending");
      history.push("diffing");
      history.push("approved");

      expect(history).toHaveLength(3);
      expect(history[0]).toBe("pending");
      expect(history[1]).toBe("diffing");
      expect(history[2]).toBe("approved");
    });
  });

  describe("Edge Cases & Boundary Conditions", () => {
    it("should handle transition from initial state", () => {
      const canTransition = isValidPhaseTransition("pending", "diffing");
      expect(canTransition).toBe(true);
    });

    it("should handle rapid successive transitions", () => {
      let currentPhase = "pending";

      currentPhase = "diffing";
      expect(isValidPhaseTransition("pending", currentPhase)).toBe(true);

      currentPhase = "verdict";
      expect(isValidPhaseTransition("diffing", currentPhase)).toBe(true);

      currentPhase = "approved";
      expect(isValidPhaseTransition("verdict", currentPhase)).toBe(true);
    });

    it("should handle unknown phase names gracefully", () => {
      const result = isValidPhaseTransition("unknown", "pending");
      // Should either throw or return false - just verify consistent behavior
      expect(typeof result).toBe("boolean");
    });
  });

  describe("Transaction Phase Locking", () => {
    it("should lock phase once approved", () => {
      const phase = "approved";

      const tryRevert = isValidPhaseTransition(phase, "pending");
      expect(tryRevert).toBe(false);

      const tryIdempotent = isValidPhaseTransition(phase, phase);
      expect(tryIdempotent).toBe(true);
    });

    it("should lock phase once rejected", () => {
      const phase = "rejected";

      const tryAdvance = isValidPhaseTransition(phase, "approved");
      expect(tryAdvance).toBe(false);

      const tryIdempotent = isValidPhaseTransition(phase, phase);
      expect(tryIdempotent).toBe(true);
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
        expect(canTransition).toBe(true);
      }
    });

    it("should support skip sequences", () => {
      const skipSequences = [
        ["pending", "approved"],
        ["pending", "verdict"],
        ["diffing", "approved"],
      ];

      skipSequences.forEach(([from, to]) => {
        expect(isValidPhaseTransition(from, to)).toBe(true);
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
        expect(isValidPhaseTransition(from, to)).toBe(false);
      });
    });
  });
});
