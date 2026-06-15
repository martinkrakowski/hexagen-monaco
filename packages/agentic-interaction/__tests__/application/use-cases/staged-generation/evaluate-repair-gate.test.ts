import { test, describe } from "node:test";
import assert from "node:assert";
import {
  evaluateRepairGate,
  stripReconstructionArtifacts,
} from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

// The Stage-7 integrity gate's decision surface. Pre-fix this lived inline in
// the orchestrator and required EXACT count preservation, which rejected the
// legitimate additive R03/R05 repairs — see
// docs/planning/stage7-repair-rca-and-remediation.md §4-B3.
const counts = (
  contextCount: number,
  portCount: number,
  adapterCount: number,
) => ({
  contextCount,
  portCount,
  adapterCount,
});

describe("evaluateRepairGate — Stage-7 decision surface", () => {
  test("rename fix: fewer errors, counts identical → APPLIED", () => {
    assert.deepStrictEqual(
      evaluateRepairGate({
        errorsBefore: 5,
        errorsAfter: 3,
        before: counts(7, 65, 57),
        after: counts(7, 65, 57),
      }),
      { applied: true, reason: "applied" },
    );
  });

  test("add a repository port (R03 fix): fewer errors, ports GREW → APPLIED (today impossible — the old preserve-gate rejected additions)", () => {
    const g = evaluateRepairGate({
      errorsBefore: 4,
      errorsAfter: 3,
      before: counts(7, 65, 57),
      after: counts(7, 66, 57),
    });
    assert.strictEqual(g.applied, true);
  });

  test("drop a context to shed R01: fewer errors but contextCount fell → REJECTED", () => {
    assert.deepStrictEqual(
      evaluateRepairGate({
        errorsBefore: 26,
        errorsAfter: 0,
        before: counts(7, 65, 57),
        after: counts(6, 40, 30),
      }),
      { applied: false, reason: "structure-shrunk-or-context-drift" },
    );
  });

  test("delete the offending port to shed its finding: fewer errors but ports shrank → REJECTED", () => {
    const g = evaluateRepairGate({
      errorsBefore: 5,
      errorsAfter: 4,
      before: counts(7, 65, 57),
      after: counts(7, 64, 57),
    });
    assert.strictEqual(g.applied, false);
    assert.strictEqual(g.reason, "structure-shrunk-or-context-drift");
  });

  test("pad with filler ports but no error reduction → REJECTED (no-error-reduction)", () => {
    assert.deepStrictEqual(
      evaluateRepairGate({
        errorsBefore: 5,
        errorsAfter: 5,
        before: counts(7, 65, 57),
        after: counts(7, 70, 57),
      }),
      { applied: false, reason: "no-error-reduction" },
    );
  });

  test("invent a context: even with fewer errors → REJECTED (context must be exact)", () => {
    const g = evaluateRepairGate({
      errorsBefore: 5,
      errorsAfter: 3,
      before: counts(7, 65, 57),
      after: counts(8, 70, 60),
    });
    assert.strictEqual(g.applied, false);
  });
});

describe("stripReconstructionArtifacts — R16/R17 exclusion", () => {
  test("drops R16/R17 from errors AND warnings, recomputes passed", () => {
    const r = stripReconstructionArtifacts({
      errors: ["[R18] leak", "[R17] forAggregate Ghost"],
      warnings: ["[R16] trivial description", "[R02] heads up"],
      passed: false,
    });
    assert.deepStrictEqual(r.errors, ["[R18] leak"]);
    assert.deepStrictEqual(r.warnings, ["[R02] heads up"]);
    assert.strictEqual(r.passed, false);
  });

  test("a report whose only error was R17 → passed:true after strip", () => {
    const r = stripReconstructionArtifacts({
      errors: ["[R17] x"],
      warnings: [],
      passed: false,
    });
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.passed, true);
  });
});
