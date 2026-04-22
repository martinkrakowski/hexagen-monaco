import { DefaultVerdictComparatorAdapter } from "../../../src/infrastructure/adapters/default-verdict-comparator.adapter.js";
import type { CompareVerdictsPort } from "../../../src/application/ports/in/compare-verdicts.port.js";
import type { Verdict } from "../../../src/domain/verdict.js";

describe("DefaultVerdictComparatorAdapter", () => {
  let adapter: CompareVerdictsPort;

  beforeEach(() => {
    adapter = new DefaultVerdictComparatorAdapter();
  });

  describe("compareVerdicts", () => {
    it("should return 1 when first verdict is accepted and second is not", () => {
      const a: Verdict = {
        id: "verdict-a",
        patchId: "patch-a",
        accepted: true,
        reason: "",
        timestamp: 1000,
      };
      const b: Verdict = {
        id: "verdict-b",
        patchId: "patch-b",
        accepted: false,
        reason: "",
        timestamp: 1000,
      };

      expect(adapter.compareVerdicts(a, b)).toBe(1);
    });

    it("should return -1 when first verdict is not accepted and second is", () => {
      const a: Verdict = {
        id: "verdict-a",
        patchId: "patch-a",
        accepted: false,
        reason: "",
        timestamp: 1000,
      };
      const b: Verdict = {
        id: "verdict-b",
        patchId: "patch-b",
        accepted: true,
        reason: "",
        timestamp: 1000,
      };

      expect(adapter.compareVerdicts(a, b)).toBe(-1);
    });

    it("should return 1 when both accepted and first has newer timestamp", () => {
      const a: Verdict = {
        id: "verdict-a",
        patchId: "patch-a",
        accepted: true,
        reason: "",
        timestamp: 2000,
      };
      const b: Verdict = {
        id: "verdict-b",
        patchId: "patch-b",
        accepted: true,
        reason: "",
        timestamp: 1000,
      };

      expect(adapter.compareVerdicts(a, b)).toBe(1);
    });

    it("should return -1 when both accepted and first has older timestamp", () => {
      const a: Verdict = {
        id: "verdict-a",
        patchId: "patch-a",
        accepted: true,
        reason: "",
        timestamp: 1000,
      };
      const b: Verdict = {
        id: "verdict-b",
        patchId: "patch-b",
        accepted: true,
        reason: "",
        timestamp: 2000,
      };

      expect(adapter.compareVerdicts(a, b)).toBe(-1);
    });

    it("should return 1 when both not accepted and first has newer timestamp", () => {
      const a: Verdict = {
        id: "verdict-a",
        patchId: "patch-a",
        accepted: false,
        reason: "",
        timestamp: 2000,
      };
      const b: Verdict = {
        id: "verdict-b",
        patchId: "patch-b",
        accepted: false,
        reason: "",
        timestamp: 1000,
      };

      expect(adapter.compareVerdicts(a, b)).toBe(1);
    });

    it("should return -1 when both not accepted and first has older timestamp", () => {
      const a: Verdict = {
        id: "verdict-a",
        patchId: "patch-a",
        accepted: false,
        reason: "",
        timestamp: 1000,
      };
      const b: Verdict = {
        id: "verdict-b",
        patchId: "patch-b",
        accepted: false,
        reason: "",
        timestamp: 2000,
      };

      expect(adapter.compareVerdicts(a, b)).toBe(-1);
    });

    it("should use ID for tie-breaking when accepted status and timestamp are equal", () => {
      const a: Verdict = {
        id: "verdict-z",
        patchId: "patch-a",
        accepted: true,
        reason: "",
        timestamp: 1000,
      };
      const b: Verdict = {
        id: "verdict-a",
        patchId: "patch-b",
        accepted: true,
        reason: "",
        timestamp: 1000,
      };

      // 'verdict-z' > 'verdict-a' lexicographically, so a should be greater than b
      expect(adapter.compareVerdicts(a, b)).toBe(1);
      expect(adapter.compareVerdicts(b, a)).toBe(-1);
    });

    it("should return 0 when verdicts are identical", () => {
      const a: Verdict = {
        id: "verdict-a",
        patchId: "patch-a",
        accepted: true,
        reason: "",
        timestamp: 1000,
      };
      const b: Verdict = {
        id: "verdict-a",
        patchId: "patch-a",
        accepted: true,
        reason: "",
        timestamp: 1000,
      };

      expect(adapter.compareVerdicts(a, b)).toBe(0);
    });
  });
});
