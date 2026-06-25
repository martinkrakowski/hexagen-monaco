import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  detectConflicts,
  type RuleExecutionManifest,
} from "../../../src/domain/transaction.js";
import { createTransaction } from "../../../src/domain/transaction.js";

describe("Conflict Detection", () => {
  describe("detectConflicts()", () => {
    it("should detect REM state mismatch when fewer rules applied than required", () => {
      const tx = createTransaction("intent-1", { rulesApplied: 1 });
      const rem: RuleExecutionManifest = {
        rules: { rule1: {}, rule2: {}, rule3: {} },
        constraints: {},
        appliedAt: "2024-01-01T00:00:00Z",
      };

      const conflictSet = detectConflicts(tx, rem);

      assert.strictEqual(conflictSet.hasConflicts, true);
      assert.strictEqual(conflictSet.conflicts.length, 1);
      assert.strictEqual(conflictSet.conflicts[0].type, "state-mismatch");
      assert.strictEqual(conflictSet.conflicts[0].severity, "warning");
      assert.strictEqual(conflictSet.conflicts[0].remExpected, 3);
      assert.strictEqual(conflictSet.conflicts[0].actualState, 1);
    });

    it("should have no conflicts when state matches REM", () => {
      const tx = createTransaction("intent-1", { rulesApplied: 3 });
      const rem: RuleExecutionManifest = {
        rules: { rule1: {}, rule2: {}, rule3: {} },
        constraints: {},
        appliedAt: "2024-01-01T00:00:00Z",
      };

      const conflictSet = detectConflicts(tx, rem);

      assert.strictEqual(conflictSet.hasConflicts, false);
      assert.strictEqual(conflictSet.conflicts.length, 0);
    });

    it("should handle missing rulesApplied in metadata", () => {
      const tx = createTransaction("intent-1", {});
      const rem: RuleExecutionManifest = {
        rules: { rule1: {}, rule2: {} },
        constraints: {},
        appliedAt: "2024-01-01T00:00:00Z",
      };

      const conflictSet = detectConflicts(tx, rem);

      assert.strictEqual(conflictSet.hasConflicts, true);
      assert.strictEqual(conflictSet.conflicts[0].remExpected, 2);
      assert.strictEqual(conflictSet.conflicts[0].actualState, 0);
    });

    it("should detect lineage integrity issues", () => {
      const tx = createTransaction("intent-1", { lineage: [] });
      const rem: RuleExecutionManifest = {
        rules: {},
        constraints: {},
        appliedAt: "2024-01-01T00:00:00Z",
      };

      const conflictSet = detectConflicts(tx, rem);

      assert.strictEqual(conflictSet.hasConflicts, true);
      assert.ok(conflictSet.conflicts.some((c) => c.type === "lineage-broken"));
    });

    it("should not detect lineage conflicts when lineage is valid", () => {
      const tx = createTransaction("intent-1", { lineage: ["intent-0"] });
      const rem: RuleExecutionManifest = {
        rules: {},
        constraints: {},
        appliedAt: "2024-01-01T00:00:00Z",
      };

      const conflictSet = detectConflicts(tx, rem);

      assert.ok(
        !conflictSet.conflicts.some((c) => c.type === "lineage-broken"),
      );
    });

    it("should set detectedAt timestamp", () => {
      const tx = createTransaction("intent-1", {});
      const rem: RuleExecutionManifest = {
        rules: {},
        constraints: {},
        appliedAt: "2024-01-01T00:00:00Z",
      };
      const before = new Date();

      const conflictSet = detectConflicts(tx, rem);

      const after = new Date();
      assert.ok(conflictSet.detectedAt.getTime() >= before.getTime());
      assert.ok(conflictSet.detectedAt.getTime() <= after.getTime());
    });
  });
});
