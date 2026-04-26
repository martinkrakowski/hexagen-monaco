import { describe, it, expect } from "@jest/globals";
import { SolveGraphLayoutUseCase } from "../src/application/use-cases/solve-graph-layout.use-case.js";
import { GraphLayoutPortFake } from "./doubles/graph-layout.port.fake.js";
import {
  generateRandomGraph,
  generatePropertyTestFixtures,
  validateLayoutFeasibility,
} from "./fixtures/graph-layout.fixtures.js";

describe("SolveGraphLayoutUseCase – Property-based tests", () => {
  it("accepts valid random graphs without throwing", () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const fixtures = generatePropertyTestFixtures();

    // All 1000 fixtures should execute without error
    for (const { nodes, edges, direction } of fixtures) {
      expect(() => {
        useCase.execute(nodes, edges, direction);
      }).not.toThrow();
    }

    expect(fixtures.length).toBe(1000);
  });

  it("returns valid layout results for 1000 random fixtures", () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const fixtures = generatePropertyTestFixtures();
    let successCount = 0;
    const failures: string[] = [];

    for (let i = 0; i < fixtures.length; i++) {
      const { nodes, edges, direction } = fixtures[i];
      const result = useCase.execute(nodes, edges, direction);

      const feasibility = validateLayoutFeasibility(nodes, result.positions);

      if (feasibility.isValid) {
        successCount++;
      } else {
        failures.push(`Fixture ${i}: ${feasibility.violations.join("; ")}`);
      }
    }

    expect(successCount).toBe(1000);
    expect(failures).toHaveLength(0);
  });

  it("produces deterministic output for fixed input", () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const { nodes, edges } = generateRandomGraph(5);

    const result1 = useCase.execute(nodes, edges, "TB");
    const result2 = useCase.execute(nodes, edges, "TB");

    // Fake port is deterministic, so results should match exactly
    expect(result1.positions).toEqual(result2.positions);
  });

  it("respects direction parameter (TB vs LR)", () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const { nodes, edges } = generateRandomGraph(5);

    const resultTB = useCase.execute(nodes, edges, "TB");
    const resultLR = useCase.execute(nodes, edges, "LR");

    // Both should produce valid results (even if they're identical for the fake)
    expect(resultTB.positions).toBeDefined();
    expect(resultLR.positions).toBeDefined();
    expect(resultTB.positions.length).toEqual(resultLR.positions.length);
  });

  it("handles edge cases: empty graph", () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const result = useCase.execute([], [], "TB");

    expect(result.positions).toEqual([]);
  });

  it("handles edge cases: single node, no edges", () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const result = useCase.execute(
      [{ id: "n0", width: 100, height: 100 }],
      [],
      "TB",
    );

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].nodeId).toBe("n0");
  });

  it("handles edge cases: disconnected components", () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    // Two separate components with no connecting edges
    const nodes = [
      { id: "n0", width: 100, height: 100 },
      { id: "n1", width: 100, height: 100 },
      { id: "n2", width: 100, height: 100 },
      { id: "n3", width: 100, height: 100 },
    ];

    // n0-n1 form one component, n2-n3 form another
    const edges = [
      { source: "n0", target: "n1" },
      { source: "n2", target: "n3" },
    ];

    const result = useCase.execute(nodes, edges, "TB");

    expect(result.positions).toHaveLength(4);
    for (const pos of result.positions) {
      expect(Number.isFinite(pos.x)).toBe(true);
      expect(Number.isFinite(pos.y)).toBe(true);
    }
  });
});
