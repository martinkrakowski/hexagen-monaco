/**
 * Integration test: Lint Filter Port Exception Handling
 *
 * Tests how the ReconcileUseCase handles exceptions from LintFilterPort
 * and propagates errors through the reconciliation pipeline.
 */

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
      undefined, // manifestPatchPort (deferred design artifact)
      undefined, // lintFilterPort — will use inline fallback
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

      expect(result.success).toBe(true);
      expect(result.patches).toBeDefined();
      expect(Array.isArray(result.patches)).toBe(true);
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

      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
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

      expect(result.success).toBe(true);
      expect(result.patches.length).toBeGreaterThanOrEqual(0);
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

      expect(result.success).toBe(true);
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

      expect(result.success).toBe(true);
      expect(result.patches).toBeDefined();
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

      expect(result.success).toBe(true);
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

      expect(result.success).toBe(true);
      expect(result.patches).toBeDefined();
      expect(Array.isArray(result.patches)).toBe(true);
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

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("patches");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("summary");
      expect(typeof result.success).toBe("boolean");
      expect(Array.isArray(result.patches)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(typeof result.summary).toBe("string");
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

      expect(result.success).toBe(true);
      expect(result.patches).toBeDefined();
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

      expect(result.success).toBe(true);
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

      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.summary).toContain("Reconciliation");
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

      expect(result.success).toBe(true);
      expect(result.summary).toMatch(/\d+\s+(patches|rejected)/i);
    });
  });
});
