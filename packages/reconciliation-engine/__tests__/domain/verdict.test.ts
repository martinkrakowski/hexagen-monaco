import { createVerdict } from "../../src/domain/verdict.js";

describe("Verdict", () => {
  describe("createVerdict", () => {
    it("should create a verdict with unique id", () => {
      const v1 = createVerdict("patch-1", true, "Accepted");
      const v2 = createVerdict("patch-2", false, "Rejected");

      expect(v1.id).not.toBe(v2.id);
      expect(v1.id).toMatch(/^verdict-/);
    });

    it("should create a verdict with correct properties", () => {
      const verdict = createVerdict("patch-123", true, "Because reasons");

      expect(verdict.patchId).toBe("patch-123");
      expect(verdict.accepted).toBe(true);
      expect(verdict.reason).toBe("Because reasons");
      expect(typeof verdict.timestamp).toBe("number");
      expect(verdict.timestamp).toBeGreaterThan(0);
    });

    it("should create a verdict with default reason when not provided", () => {
      const verdict = createVerdict("patch-456", false);

      expect(verdict.reason).toBe("");
    });
  });
});
