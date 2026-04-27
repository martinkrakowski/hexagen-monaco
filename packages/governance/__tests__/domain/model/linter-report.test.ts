import assert from "node:assert";
import {
  BoundaryViolationSchema,
  DependencyEventSchema,
  LinterReportSchema,
  ArchitecturalEventSchema,
} from "../../../src/domain/model/linter-report/index.js";

(() => {
  const violationResult = BoundaryViolationSchema.safeParse({
    ruleId: "no-infrastructure-in-domain",
    severity: "error",
    file: "packages/sync/src/domain/example.ts",
    message: "Domain layer cannot import infrastructure",
  });
  assert.strictEqual(
    violationResult.success,
    true,
    "BoundaryViolationSchema should validate violation records",
  );

  const linterResult = LinterReportSchema.safeParse({
    timestamp: new Date().toISOString(),
    isCompliant: true,
    violations: [],
    scannedFilesCount: 12,
  });
  assert.strictEqual(
    linterResult.success,
    true,
    "LinterReportSchema should validate linter report payload",
  );

  const dependencyEventResult = DependencyEventSchema.safeParse({
    source: "project-configuration",
    target: "sync",
    relationship: "depends_on",
  });
  assert.strictEqual(
    dependencyEventResult.success,
    true,
    "DependencyEventSchema should validate dependency events",
  );

  const architecturalEventResult = ArchitecturalEventSchema.safeParse({
    eventId: "4d247a8f-ebf8-4f93-8fdb-347f8ea9a7f2",
    timestamp: new Date().toISOString(),
    type: "DependencyAdded",
    payload: { source: "project-configuration", target: "sync" },
  });
  assert.strictEqual(
    architecturalEventResult.success,
    true,
    "ArchitecturalEventSchema should validate architectural events",
  );

  console.log("✅ linter-report tests passed");
})();
