import { ReconcileUseCase } from "../application/use-cases/reconcile.use-case.js";
import { StructuredDiffReconciliationAdapter } from "../infrastructure/adapters/structured-diff-reconciliation.adapter.js";
import { VerdictComparatorAdapter } from "../infrastructure/adapters/verdict-comparator.adapter.js";
import { MonotonicStatePromoterAdapter } from "../infrastructure/adapters/monotonic-state-promoter.adapter.js";
import { GovernanceAwareConflictResolverAdapter } from "../infrastructure/adapters/governance-aware-conflict-resolver.adapter.js";
import type { ReconcileRequest } from "../application/ports/in/reconcile.port.js";
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
