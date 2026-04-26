import { ReconcileUseCase } from "../application/use-cases/reconcile.use-case.js";
import { StructuredDiffReconciliationAdapter } from "../infrastructure/adapters/structured-diff-reconciliation.adapter.js";
import { VerdictComparatorAdapter } from "../infrastructure/adapters/verdict-comparator.adapter.js";
import { MonotonicStatePromoterAdapter } from "../infrastructure/adapters/monotonic-state-promoter.adapter.js";
import { GovernanceAwareConflictResolverAdapter } from "../infrastructure/adapters/governance-aware-conflict-resolver.adapter.js";
import { LinterReportFilterAdapter } from "../infrastructure/adapters/linter-report-filter.adapter.js";
import type { ReconcileRequest } from "../application/ports/in/reconcile.port.js";
import type { LinterReportLike } from "../application/ports/in/lint-filter.port.js";
import type {
  ProjectSpecLike,
  ArchitectureGraphLike,
  ReconciliationResult,
} from "../domain/llm-response.js";
import type { ReconciliationPort } from "../application/ports/in/reconcile.port.js";

class FailingReconciliationAdapter implements ReconciliationPort {
  async reconcile(): Promise<ReconciliationResult> {
    return {
      success: false,
      patches: [],
      errors: ["Diff failed"],
      summary: "Reconciliation failed",
    };
  }
}

describe("ReconcileUseCase", () => {
  let useCase: ReconcileUseCase;

  beforeEach(() => {
    useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
    );
  });

  const makeRequest = (
    manifest: ProjectSpecLike,
    graph: ArchitectureGraphLike,
    currentManifest: ProjectSpecLike,
  ): ReconcileRequest => ({
    structuredOutput: {
      manifest,
      architectureGraph: graph,
      reasoning: "test",
    },
    currentManifest,
    intentId: "test-intent",
  });

  it("should reconcile added bounded contexts", async () => {
    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await useCase.execute(request);

    expect(result.success).toBe(true);
    expect(result.patches.length).toBeGreaterThanOrEqual(1);
    expect(result.patches.some((p) => p.type === "add_node")).toBe(true);
  });

  it("should reconcile removed bounded contexts", async () => {
    const request = makeRequest(
      { boundedContexts: [] },
      { nodes: [], edges: [] },
      { boundedContexts: [{ id: "bc-1", name: "OldContext" }] },
    );

    const result = await useCase.execute(request);

    expect(result.success).toBe(true);
    expect(result.patches.length).toBeGreaterThanOrEqual(1);
  });

  it("should return empty patches when no changes", async () => {
    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "Same" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [{ id: "bc-1", name: "Same" }] },
    );

    const result = await useCase.execute(request);

    expect(result.success).toBe(true);
    expect(result.patches).toHaveLength(0);
  });

  it("should propagate diff errors from failing adapter", async () => {
    const failingUseCase = new ReconcileUseCase(
      new FailingReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
    );

    const request = makeRequest(
      { boundedContexts: [] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await failingUseCase.execute(request);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Diff failed");
  });

  it("should handle mixed changes across contexts and graph", async () => {
    const request = makeRequest(
      {
        boundedContexts: [
          { id: "bc-1", name: "ExistingRenamed" },
          { id: "bc-new", name: "BrandNew" },
        ],
      },
      {
        nodes: [{ id: "n-1", label: "Port", type: "port", status: "added" }],
        edges: [],
      },
      { boundedContexts: [{ id: "bc-1", name: "Existing" }] },
    );

    const result = await useCase.execute(request);

    expect(result.success).toBe(true);
    expect(result.patches.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ReconcileUseCase with LintFilterPort", () => {
  const makeRequest = (
    manifest: ProjectSpecLike,
    graph: ArchitectureGraphLike,
    currentManifest: ProjectSpecLike,
  ): ReconcileRequest => ({
    structuredOutput: {
      manifest,
      architectureGraph: graph,
      reasoning: "test",
    },
    currentManifest,
    intentId: "test-intent",
  });

  const makeReport = (
    violations: LinterReportLike["violations"],
  ): LinterReportLike => ({
    timestamp: new Date().toISOString(),
    isCompliant: violations.length === 0,
    violations,
    scannedFilesCount: 10,
  });

  it("should filter patches when lint report has errors", async () => {
    const useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
      undefined,
      new LinterReportFilterAdapter(),
    );

    const report = makeReport([
      {
        ruleId: "R001",
        severity: "error",
        file: "bc-1",
        message: "Boundary violation",
      },
    ]);

    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await useCase.execute(request, undefined, report);

    expect(result.success).toBe(true);
    expect(result.patches).toHaveLength(0);
    expect(result.summary).toContain("1 rejected");
  });

  it("should not filter patches when lint report is compliant", async () => {
    const useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
      undefined,
      new LinterReportFilterAdapter(),
    );

    const report = makeReport([]);

    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await useCase.execute(request, undefined, report);

    expect(result.success).toBe(true);
    expect(result.patches.length).toBeGreaterThanOrEqual(1);
  });

  it("should pass through patches when no lint report is provided", async () => {
    const useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
      undefined,
      new LinterReportFilterAdapter(),
    );

    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await useCase.execute(request);

    expect(result.success).toBe(true);
    expect(result.patches.length).toBeGreaterThanOrEqual(1);
  });

  it("should reject patch when lint report has error on target file", async () => {
    const useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
      undefined,
      new LinterReportFilterAdapter(),
    );

    const report = makeReport([
      {
        ruleId: "R001",
        severity: "error",
        file: "bc-1",
        message: "Boundary violation",
      },
    ]);

    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await useCase.execute(request, undefined, report);

    expect(result.success).toBe(true);
    expect(result.patches).toHaveLength(0);
    expect(result.summary).toContain("rejected");
  });

  it("should accept patch when lint report is clean", async () => {
    const useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
      undefined,
      new LinterReportFilterAdapter(),
    );

    const report = makeReport([]);

    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await useCase.execute(request, undefined, report);

    expect(result.success).toBe(true);
    expect(result.patches.length).toBeGreaterThanOrEqual(1);
  });

  it("should accept all patches when no linter report provided", async () => {
    const useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
      undefined,
      new LinterReportFilterAdapter(),
    );

    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await useCase.execute(request);

    expect(result.success).toBe(true);
    expect(result.patches.length).toBeGreaterThanOrEqual(1);
  });

  it("should reject patches when lint report has errors even without LintFilterPort", async () => {
    const useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      new MonotonicStatePromoterAdapter(),
    );

    const report = makeReport([
      {
        ruleId: "R001",
        severity: "error",
        file: "bc-1",
        message: "Should not matter",
      },
    ]);

    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await useCase.execute(request, undefined, report);

    expect(result.success).toBe(true);
    expect(result.patches).toHaveLength(0);
    expect(result.summary).toContain("rejected");
  });
});
