import { LinterReportFilterAdapter } from "../infrastructure/adapters/linter-report-filter.adapter.js";
import { createPatch } from "../domain/llm-response.js";
import type { LinterReportLike } from "../application/ports/in/lint-filter.port.js";

describe("LinterReportFilterAdapter", () => {
  let adapter: LinterReportFilterAdapter;

  beforeEach(() => {
    adapter = new LinterReportFilterAdapter();
  });

  const compliantReport: LinterReportLike = {
    timestamp: new Date().toISOString(),
    isCompliant: true,
    violations: [],
    scannedFilesCount: 10,
  };

  const makeReport = (
    violations: LinterReportLike["violations"],
  ): LinterReportLike => ({
    timestamp: new Date().toISOString(),
    isCompliant: violations.length === 0,
    violations,
    scannedFilesCount: 10,
  });

  it("should pass all patches through when report is compliant", () => {
    const patches = [
      createPatch("add_node", "my-context", { name: "MyContext" }),
      createPatch("add_edge", "edge-1", { source: "a", target: "b" }),
    ];

    const result = adapter.filterPatches(patches, compliantReport);

    expect(result).toHaveLength(2);
  });

  it("should pass all patches through when report has no error-severity violations", () => {
    const report = makeReport([
      {
        ruleId: "R001",
        severity: "warning",
        file: "my-context",
        message: "Consider refactoring",
      },
    ]);

    const patches = [
      createPatch("add_node", "my-context", { name: "MyContext" }),
    ];

    const result = adapter.filterPatches(patches, report);

    expect(result).toHaveLength(1);
  });

  it("should reject patches whose targetId matches an error violation file", () => {
    const report = makeReport([
      {
        ruleId: "R002",
        severity: "error",
        file: "shared-kernel",
        message: "Cross-boundary violation",
      },
    ]);

    const patches = [
      createPatch("update_node", "shared-kernel", { name: "Kernel" }),
      createPatch("add_node", "safe-context", { name: "Safe" }),
    ];

    const result = adapter.filterPatches(patches, report);

    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe("safe-context");
  });

  it("should reject patches whose payload.file matches an error violation", () => {
    const report = makeReport([
      {
        ruleId: "R003",
        severity: "error",
        file: "packages/core-domain",
        message: "Invalid import",
      },
    ]);

    const patches = [
      createPatch("add_edge", "edge-1", {
        source: "a",
        target: "b",
        file: "packages/core-domain",
      }),
      createPatch("add_edge", "edge-2", {
        source: "c",
        target: "d",
        file: "packages/safe-package",
      }),
    ];

    const result = adapter.filterPatches(patches, report);

    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe("edge-2");
  });

  it("should reject patches whose payload.target matches an error violation", () => {
    const report = makeReport([
      {
        ruleId: "R004",
        severity: "error",
        file: "governance",
        message: "Protected context",
      },
    ]);

    const patches = [
      createPatch("remove_node", "node-1", { target: "governance" }),
      createPatch("add_node", "node-2", { target: "safe-target" }),
    ];

    const result = adapter.filterPatches(patches, report);

    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe("node-2");
  });

  it("should extract first path segment from violation file for broader matching", () => {
    const report = makeReport([
      {
        ruleId: "R005",
        severity: "error",
        file: "packages/reconciliation-engine/src/some-file.ts",
        message: "Layer violation",
      },
    ]);

    const patches = [
      createPatch("update_node", "packages", { name: "Packages" }),
      createPatch("add_node", "other", { name: "Other" }),
    ];

    const result = adapter.filterPatches(patches, report);

    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe("other");
  });

  it("should handle multiple error violations blocking multiple targets", () => {
    const report = makeReport([
      {
        ruleId: "R006",
        severity: "error",
        file: "context-a",
        message: "Violation A",
      },
      {
        ruleId: "R007",
        severity: "error",
        file: "context-b",
        message: "Violation B",
      },
    ]);

    const patches = [
      createPatch("add_node", "context-a", {}),
      createPatch("add_node", "context-b", {}),
      createPatch("add_node", "context-c", {}),
    ];

    const result = adapter.filterPatches(patches, report);

    expect(result).toHaveLength(1);
    expect(result[0].targetId).toBe("context-c");
  });

  it("should pass all patches when report has no violations", () => {
    const report = makeReport([]);

    const patches = [
      createPatch("add_node", "ctx-1", {}),
      createPatch("add_node", "ctx-2", {}),
      createPatch("add_edge", "edge-1", {}),
    ];

    const result = adapter.filterPatches(patches, report);

    expect(result).toHaveLength(3);
  });
});
