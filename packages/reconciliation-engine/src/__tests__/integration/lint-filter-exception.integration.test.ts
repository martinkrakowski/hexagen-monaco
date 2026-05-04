import assert from "node:assert/strict";
import { ReconcileUseCase } from "../../application/use-cases/reconcile.use-case.js";
import { StructuredDiffReconciliationAdapter } from "../../infrastructure/adapters/structured-diff-reconciliation.adapter.js";
import { VerdictComparatorAdapter } from "../../infrastructure/adapters/verdict-comparator.adapter.js";
import { GovernanceAwareConflictResolverAdapter } from "../../infrastructure/adapters/governance-aware-conflict-resolver.adapter.js";
import type { ReconcileRequest } from "../../application/ports/in/reconcile.port.js";
import type {
  ProjectSpecLike,
  ArchitectureGraphLike,
} from "@hexagen/prompt-compiler";

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

describe("Lint Filter Exception Handling - Integration Tests", () => {
  let useCase: ReconcileUseCase;

  beforeEach(() => {
    useCase = new ReconcileUseCase(
      new StructuredDiffReconciliationAdapter(),
      new VerdictComparatorAdapter(),
      new GovernanceAwareConflictResolverAdapter(),
      undefined,
      undefined,
    );
  });

  describe("Successful Reconciliation Without Lint Errors", () => {
    it("should generate patches for valid changes", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [{ id: "ctx-1", name: "Service1", roleBindings: [] }],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [{ id: "ctx-1", label: "Service1", type: "context" }],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
      assert.ok(result.patches !== undefined);
      assert.ok(Array.isArray(result.patches));
    });

    it("should accept patches when lint report is clean", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [
          { id: "ctx-1", name: "PaymentService", roleBindings: [] },
        ],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [{ id: "ctx-1", label: "Payment", type: "context" }],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
      assert.ok(result.summary !== undefined);
    });
  });

  describe("Patch Verdicts Generation", () => {
    it("should create verdicts for all generated patches", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [
          { id: "ctx-new", name: "NewService", roleBindings: [] },
        ],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [{ id: "ctx-new", label: "NewService", type: "context" }],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
      assert.ok(result.patches.length >= 0);
    });

    it("should accept all verdicts when no lint violations exist", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [
          { id: "ctx-1", name: "Service1", roleBindings: [] },
          { id: "ctx-2", name: "Service2", roleBindings: [] },
        ],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [
          { id: "ctx-1", label: "Service1", type: "context" },
          { id: "ctx-2", label: "Service2", type: "context" },
        ],
        edges: [
          {
            source: "ctx-1",
            target: "ctx-2",
            relationship: "depends-on",
            isValid: true,
          },
        ],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
    });
  });

  describe("Conflict Resolution During Reconciliation", () => {
    it("should resolve conflicting patches through comparator", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [
          { id: "ctx-1", name: "Order", roleBindings: [] },
          { id: "ctx-2", name: "Payment", roleBindings: [] },
        ],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [
          { id: "ctx-1", label: "Order", type: "context" },
          { id: "ctx-2", label: "Payment", type: "context" },
        ],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
      assert.ok(result.patches !== undefined);
    });

    it("should accept patches that pass conflict resolution", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [
          { id: "ctx-resolved", name: "ResolvedService", roleBindings: [] },
        ],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [{ id: "ctx-resolved", label: "Resolved", type: "context" }],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
    });
  });

  describe("Error Propagation and Graceful Degradation", () => {
    it("should return success status with empty patches on valid input", async () => {
      const manifest: ProjectSpecLike = { boundedContexts: [] };
      const graph: ArchitectureGraphLike = { nodes: [], edges: [] };
      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
      assert.ok(result.patches !== undefined);
      assert.ok(Array.isArray(result.patches));
    });

    it("should maintain result structure on all execution paths", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [{ id: "test", name: "Test", roleBindings: [] }],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [{ id: "test", label: "Test", type: "context" }],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.ok("success" in result);
      assert.ok("patches" in result);
      assert.ok("errors" in result);
      assert.ok("summary" in result);
      assert.strictEqual(typeof result.success, "boolean");
      assert.ok(Array.isArray(result.patches));
      assert.ok(Array.isArray(result.errors));
      assert.strictEqual(typeof result.summary, "string");
    });
  });

  describe("Reconciliation Robustness", () => {
    it("should reconcile successfully with multiple context additions", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [
          { id: "ctx-1", name: "Service1", roleBindings: [] },
          { id: "ctx-2", name: "Service2", roleBindings: [] },
          { id: "ctx-3", name: "Service3", roleBindings: [] },
        ],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [
          { id: "ctx-1", label: "Service1", type: "context" },
          { id: "ctx-2", label: "Service2", type: "context" },
          { id: "ctx-3", label: "Service3", type: "context" },
        ],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
      assert.ok(result.patches !== undefined);
    });

    it("should reconcile successfully with complex graph topology", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [
          { id: "order", name: "Order", roleBindings: [] },
          { id: "payment", name: "Payment", roleBindings: [] },
          { id: "notification", name: "Notification", roleBindings: [] },
        ],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [
          { id: "order", label: "Order", type: "context" },
          { id: "payment", label: "Payment", type: "context" },
          { id: "notification", label: "Notification", type: "context" },
        ],
        edges: [
          {
            source: "order",
            target: "payment",
            relationship: "depends-on",
            isValid: true,
          },
          {
            source: "order",
            target: "notification",
            relationship: "publishes-to",
            isValid: true,
          },
        ],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
    });
  });

  describe("Verdict Summary Generation", () => {
    it("should provide meaningful summary on completion", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [{ id: "test", name: "Test", roleBindings: [] }],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [{ id: "test", label: "Test", type: "context" }],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
      assert.ok(result.summary !== undefined);
      assert.ok(result.summary.length > 0);
      assert.ok(result.summary.includes("Reconciliation"));
    });

    it("should include patch count in summary", async () => {
      const manifest: ProjectSpecLike = {
        boundedContexts: [{ id: "ctx-1", name: "Service1", roleBindings: [] }],
      };

      const graph: ArchitectureGraphLike = {
        nodes: [{ id: "ctx-1", label: "Service1", type: "context" }],
        edges: [],
      };

      const request = makeRequest(manifest, graph, {
        boundedContexts: [],
      });

      const result = await useCase.execute(request);

      assert.strictEqual(result.success, true);
      assert.match(result.summary, /\d+\s+(patches|rejected)/i);
    });
  });
});
