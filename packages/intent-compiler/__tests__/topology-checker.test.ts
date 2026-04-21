import { ValidateTopologyUseCase } from "../src/application/use-cases/validate-topology.use-case";
import { FakeTopologyChecker } from "./doubles/fake-topology-checker";
import { NodeKind, EdgeKind } from "@hexagen/core-domain";
import type { DomainAST } from "@hexagen/core-domain";
import type { TopologyCheckResult } from "../src/domain/value-objects/topology-check-result";

describe("ValidateTopologyUseCase (port-based contract)", () => {
  let fakeChecker: FakeTopologyChecker;
  let useCase: ValidateTopologyUseCase;

  beforeEach(() => {
    fakeChecker = new FakeTopologyChecker();
    useCase = new ValidateTopologyUseCase(fakeChecker);
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

    it("should return invalid result when fake detects self-loop", () => {
      const ast: DomainAST = {
        nodes: [{ id: "node1", kind: NodeKind.Entity, attributes: {} }],
        edges: [
          {
            id: "edge1",
            kind: EdgeKind.Dependency,
            source: "node1",
            target: "node1",
            attributes: {},
          },
        ],
        invariants: { topology: [], cardinality: [] },
      };

      const failingChecker = new FakeTopologyChecker(
        { isValid: true, violations: [] },
        (): TopologyCheckResult => ({
          isValid: false,
          violations: ["Acyclic: cycle detected"],
        }),
      );
      const uc = new ValidateTopologyUseCase(failingChecker);

      const result = uc.execute(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("Acyclic");
    });

    it("should return invalid result when fake detects disconnected nodes", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.ValueObject, attributes: {} },
        ],
        edges: [],
        invariants: { topology: [], cardinality: [] },
      };

      const failingChecker = new FakeTopologyChecker(
        { isValid: true, violations: [] },
        (): TopologyCheckResult => ({
          isValid: false,
          violations: ["Connected: graph is not connected"],
        }),
      );
      const uc = new ValidateTopologyUseCase(failingChecker);

      const result = uc.execute(ast);

      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("Connected");
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

    it("should return valid result for properly connected graph via default fake", () => {
      const ast: DomainAST = {
        nodes: [
          { id: "node1", kind: NodeKind.Entity, attributes: {} },
          { id: "node2", kind: NodeKind.ValueObject, attributes: {} },
        ],
        edges: [
          {
            id: "edge1",
            kind: EdgeKind.Dependency,
            source: "node1",
            target: "node2",
            attributes: {},
          },
        ],
        invariants: { topology: [], cardinality: [] },
      };

      const result = useCase.execute(ast);

      expect(result.isValid).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });
});
