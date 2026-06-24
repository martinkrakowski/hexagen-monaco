import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  BoundaryViolationSchema,
  DependencyEventSchema,
  LinterReportSchema,
  ArchitecturalEventSchema,
} from "../../../src/domain/model/linter-report/index.js";

describe("LinterReport schemas", () => {
  it("should validate violation records", () => {
    const violationResult = BoundaryViolationSchema.safeParse({
      ruleId: "no-infrastructure-in-domain",
      severity: "error",
      file: "packages/sync/src/domain/example.ts",
      message: "Domain layer cannot import infrastructure",
    });
    assert.strictEqual(violationResult.success, true);
  });

  it("should validate linter report payload", () => {
    const linterResult = LinterReportSchema.safeParse({
      timestamp: new Date().toISOString(),
      isCompliant: true,
      violations: [],
      scannedFilesCount: 12,
    });
    assert.strictEqual(linterResult.success, true);
  });

  it("should validate dependency events", () => {
    const dependencyEventResult = DependencyEventSchema.safeParse({
      source: "project-configuration",
      target: "sync",
      relationship: "depends_on",
    });
    assert.strictEqual(dependencyEventResult.success, true);
  });

  it("should validate architectural events", () => {
    const architecturalEventResult = ArchitecturalEventSchema.safeParse({
      eventId: "4d247a8f-ebf8-4f93-8fdb-347f8ea9a7f2",
      timestamp: new Date().toISOString(),
      type: "DependencyAdded",
      payload: { source: "project-configuration", target: "sync" },
    });
    assert.strictEqual(architecturalEventResult.success, true);
  });
});
