import { DefaultASTReconciliationAdapter } from "../../../src/infrastructure/adapters/ast-reconciliation.adapter.js";
import type {
  LLMResponse,
  DomainASTLike,
} from "../../../src/domain/llm-response.js";

const makeAST = (): DomainASTLike => ({
  nodes: [],
  edges: [],
  invariants: { topology: [], cardinality: [] },
});

const makeResponse = (content: string): LLMResponse => ({
  id: "resp-1",
  content,
  finishReason: "stop",
});

describe("DefaultASTReconciliationAdapter", () => {
  let adapter: DefaultASTReconciliationAdapter;

  beforeEach(() => {
    adapter = new DefaultASTReconciliationAdapter();
  });

  describe("reconcile()", () => {
    it("should return failed result for empty LLM response", async () => {
      const result = await adapter.reconcile({
        response: makeResponse(""),
        currentAST: makeAST(),
        intentId: "intent-1",
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain("LLM response content is empty");
      expect(result.patches).toHaveLength(0);
    });

    it("should parse add_node patches from LLM response", async () => {
      const result = await adapter.reconcile({
        response: makeResponse("+ Entity:Order\n+ ValueObject:Address"),
        currentAST: makeAST(),
        intentId: "intent-1",
      });

      expect(result.success).toBe(true);
      expect(result.patches.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse remove_node patches from LLM response", async () => {
      const result = await adapter.reconcile({
        response: makeResponse("- Aggregate:OldContext"),
        currentAST: makeAST(),
        intentId: "intent-1",
      });

      expect(result.patches.some((p) => p.type === "remove_node")).toBe(true);
    });

    it("should return success with summary of applied patches", async () => {
      const result = await adapter.reconcile({
        response: makeResponse("+ Entity:Order"),
        currentAST: makeAST(),
        intentId: "intent-1",
      });

      expect(result.summary).toContain("1 patches");
    });

    it("should return success with no patches for non-matching content", async () => {
      const result = await adapter.reconcile({
        response: makeResponse("This is just a normal text response."),
        currentAST: makeAST(),
        intentId: "intent-1",
      });

      expect(result.success).toBe(true);
      expect(result.patches).toHaveLength(0);
    });
  });
});
