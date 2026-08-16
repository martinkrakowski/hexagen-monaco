import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  ArchitecturalEvent,
  BoundaryViolation,
  DependencyEvent,
  LinterReport,
} from "../../../src/domain/model/linter-report/index.js";

/**
 * These were `safeParse` assertions against Zod schemas. The schemas were
 * deleted by the ADR-0054 `zod` disposition (2026-08-16) — they only ever
 * re-validated values this repo builds in-process, so the old tests asserted
 * that Zod validates a well-formed literal rather than anything about this
 * package.
 *
 * What remains is the part that was always the real contract: the SHAPE. Each
 * literal below is checked by `yarn typecheck:test` (tsc -p tsconfig.test.json),
 * so a field renamed or a union member dropped fails there; the runtime
 * assertions keep the suite honest about the literals actually being exercised.
 */
describe("LinterReport domain types", () => {
  it("describes a boundary violation", () => {
    const violation: BoundaryViolation = {
      ruleId: "no-infrastructure-in-domain",
      severity: "error",
      file: "packages/sync/src/domain/example.ts",
      message: "Domain layer cannot import infrastructure",
    };
    assert.strictEqual(violation.severity, "error");
    assert.strictEqual(violation.snippet, undefined);
  });

  it("describes a linter report payload", () => {
    const report: LinterReport = {
      timestamp: new Date().toISOString(),
      isCompliant: true,
      violations: [],
      scannedFilesCount: 12,
    };
    assert.deepStrictEqual(report.violations, []);
    assert.strictEqual(report.scannedFilesCount, 12);
  });

  it("describes a dependency event", () => {
    const event: DependencyEvent = {
      source: "project-configuration",
      target: "sync",
      relationship: "depends_on",
    };
    assert.strictEqual(event.relationship, "depends_on");
  });

  it("describes an architectural event", () => {
    const event: ArchitecturalEvent = {
      eventId: "4d247a8f-ebf8-4f93-8fdb-347f8ea9a7f2",
      timestamp: new Date().toISOString(),
      type: "DependencyAdded",
      payload: { source: "project-configuration", target: "sync" },
    };
    assert.strictEqual(event.type, "DependencyAdded");
    assert.strictEqual(event.payload.target, "sync");
  });
});
