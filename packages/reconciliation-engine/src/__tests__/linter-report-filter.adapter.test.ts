import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { LinterReportFilterAdapter } from "../infrastructure/adapters/linter-report-filter.adapter.js";
import type { Patch } from "../domain/llm-response.js";
import type { LinterReportLike } from "@hexagen/core-domain";

describe("LinterReportFilterAdapter", () => {
  let adapter: LinterReportFilterAdapter;

  beforeEach(() => {
    adapter = new LinterReportFilterAdapter();
  });

  const createPatch = (id: string, targetId: string): Patch =>
    ({
      id,
      targetId,
      payload: { file: `src/${targetId}` },
    }) as unknown as Patch;

  const createCompliantReport = (): LinterReportLike => ({
    timestamp: new Date().toISOString(),
    isCompliant: true,
    violations: [],
    scannedFilesCount: 0,
  });

  const createReportWithErrors = (files: string[]): LinterReportLike => ({
    timestamp: new Date().toISOString(),
    isCompliant: false,
    violations: files.map((file) => ({
      ruleId: "test-rule",
      severity: "error",
      file,
      message: `Error in ${file}`,
    })),
    scannedFilesCount: 1,
  });

  it("should accept all patches when report is compliant", () => {
    const patch = createPatch("1", "index.ts");
    const report = createCompliantReport();

    assert.strictEqual(adapter.shouldAccept(patch, report), true);
  });

  it("should reject patch with error in targetId", () => {
    const patch = createPatch("1", "index.ts");
    const report = createReportWithErrors(["index.ts"]);

    assert.strictEqual(adapter.shouldAccept(patch, report), false);
  });

  it("should reject patch with error in payload.file", () => {
    const patch = createPatch("1", "index.ts");
    patch.payload.file = "src/index.ts";
    const report = createReportWithErrors(["src/index.ts"]);

    assert.strictEqual(adapter.shouldAccept(patch, report), false);
  });

  it("should reject patch with error in payload.target", () => {
    const patch = createPatch("1", "index.ts");
    patch.payload.target = "src/index.ts";
    const report = createReportWithErrors(["src/index.ts"]);

    assert.strictEqual(adapter.shouldAccept(patch, report), false);
  });

  it("should accept patch when error is in different file", () => {
    const patch = createPatch("1", "index.ts");
    const report = createReportWithErrors(["other.ts"]);

    assert.strictEqual(adapter.shouldAccept(patch, report), true);
  });

  it("should block parent directories conservatively", () => {
    const patch = createPatch("1", "src");
    const report = createReportWithErrors(["src/components/Button.ts"]);

    assert.strictEqual(adapter.shouldAccept(patch, report), false);
  });

  it("should handle multiple errors across files", () => {
    const patch1 = createPatch("1", "index.ts");
    const patch2 = createPatch("2", "util.ts");
    const report = createReportWithErrors(["index.ts", "util.ts", "other.ts"]);

    assert.strictEqual(adapter.shouldAccept(patch1, report), false);
    assert.strictEqual(adapter.shouldAccept(patch2, report), false);
  });

  it("should only block error-severity violations, not warnings", () => {
    const patch = createPatch("1", "index.ts");
    const report: LinterReportLike = {
      timestamp: new Date().toISOString(),
      isCompliant: false,
      violations: [
        {
          ruleId: "warn-rule",
          severity: "warning",
          file: "index.ts",
          message: "Warning in index.ts",
        },
      ],
      scannedFilesCount: 1,
    };

    assert.strictEqual(adapter.shouldAccept(patch, report), true);
  });
});
