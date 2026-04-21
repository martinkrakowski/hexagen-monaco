import { ValidateCardinalityUseCase } from "../src/application/use-cases/validate-cardinality.use-case";
import { FakeCardinalityChecker } from "./doubles/fake-cardinality-checker";
import { NodeKind } from "@hexagen/core-domain";
import type { DomainAST } from "@hexagen/core-domain";
import type { CardinalityCheckResult } from "../src/domain/value-objects/cardinality-check-result";

describe("ValidateCardinalityUseCase (port-based contract)", () => {
  let fakeChecker: FakeCardinalityChecker;
  let useCase: ValidateCardinalityUseCase;

  beforeEach(() => {
    fakeChecker = new FakeCardinalityChecker();
    useCase = new ValidateCardinalityUseCase(fakeChecker);
  });

  describe("execute()", () => {
    it("should return valid result for empty AST via default fake", () => {
      const ast: DomainAST = {
        nodes: [],
        edges: [],
        invariants: { topology: [], cardinality: [] },
      };

      const result = useCase.execute(ast);

      expect(result.isValid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("should return invalid result when fake detects Exactly violation", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            { type: "Exactly", payload: { nodeKind: "Entity", count: 1 } },
          ],
        },
      };

      const failingChecker = new FakeCardinalityChecker(
        { isValid: true, violations: [] },
        (): CardinalityCheckResult => ({
          isValid: false,
          violations: ["Exactly: expected 1 Entity, found 2"],
        }),
      );
      const uc = new ValidateCardinalityUseCase(failingChecker);

      const result = uc.execute(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("Exactly");
    });

    it("should return invalid result when fake detects AtLeast violation", () => {
      const ast: DomainAST = {
        nodes: [{ id: "node1", kind: NodeKind.Entity, attributes: {} }],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            { type: "AtLeast", payload: { nodeKind: "Entity", count: 2 } },
          ],
        },
      };

      const failingChecker = new FakeCardinalityChecker(
        { isValid: true, violations: [] },
        (): CardinalityCheckResult => ({
          isValid: false,
          violations: ["AtLeast: expected at least 2 Entity, found 1"],
        }),
      );
      const uc = new ValidateCardinalityUseCase(failingChecker);

      const result = uc.execute(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("AtLeast");
    });

    it("should return invalid result when fake detects AtMost violation", () => {
      const failingChecker = new FakeCardinalityChecker(
        { isValid: true, violations: [] },
        (): CardinalityCheckResult => ({
          isValid: false,
          violations: ["AtMost: expected at most 2 Entity, found 3"],
        }),
      );
      const uc = new ValidateCardinalityUseCase(failingChecker);
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.Entity, attributes: {} },
          { id: "node3", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            { type: "AtMost", payload: { nodeKind: "Entity", count: 2 } },
          ],
        },
      };

      const result = uc.execute(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("AtMost");
    });

    it("should return invalid result when fake detects Between violation", () => {
      const failingChecker = new FakeCardinalityChecker(
        { isValid: true, violations: [] },
        (): CardinalityCheckResult => ({
          isValid: false,
          violations: ["Between: expected between 2 and 4 Entity, found 1"],
        }),
      );
      const uc = new ValidateCardinalityUseCase(failingChecker);
      const ast: DomainAST = {
        nodes: [{ id: "node1", kind: NodeKind.Entity, attributes: {} }],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: "Between",
              payload: { nodeKind: "Entity", min: 2, max: 4 },
            },
          ],
        },
      };

      const result = uc.execute(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("Between");
    });

    it("should pass the AST to the port exactly once", () => {
      const ast: DomainAST = {
        nodes: [],
        edges: [],
        invariants: { topology: [], cardinality: [] },
      };

      useCase.execute(ast);

      expect(fakeChecker.checkCallCount).toBe(1);
      expect(fakeChecker.lastAst).toBe(ast);
    });

    it("should return valid result when all invariants satisfied via default fake", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.Entity, attributes: {} },
        ],
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            { type: "Exactly", payload: { nodeKind: "Entity", count: 2 } },
            { type: "AtLeast", payload: { nodeKind: "Entity", count: 1 } },
            { type: "AtMost", payload: { nodeKind: "Entity", count: 3 } },
            {
              type: "Between",
              payload: { nodeKind: "Entity", min: 1, max: 3 },
            },
          ],
        },
      };

      const result = useCase.execute(ast);

      expect(result.isValid).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });
});
