import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { SolveGraphLayoutUseCase } from "../src/application/use-cases/solve-graph-layout.use-case.js";
import { GraphLayoutPortFake } from "./doubles/graph-layout.port.fake.js";
import {
  generateRandomGraph,
  generatePropertyTestFixtures,
  validateLayoutFeasibility,
} from "./fixtures/graph-layout.fixtures.js";

describe("SolveGraphLayoutUseCase – Property-based tests", () => {
  it("accepts valid random graphs without throwing", async () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const fixtures = generatePropertyTestFixtures();

    for (const { nodes, edges, direction } of fixtures) {
      await useCase.execute(nodes, edges, direction);
    }

    assert.strictEqual(fixtures.length, 1000);
  });

  it("returns valid layout results for 1000 random fixtures", async () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const fixtures = generatePropertyTestFixtures();
    let successCount = 0;
    const failures: string[] = [];

    for (let i = 0; i < fixtures.length; i++) {
      const { nodes, edges, direction } = fixtures[i];
      const result = await useCase.execute(nodes, edges, direction);

      const feasibility = validateLayoutFeasibility(nodes, result.positions);

      if (feasibility.isValid) {
        successCount++;
      } else {
        failures.push(`Fixture ${i}: ${feasibility.violations.join("; ")}`);
      }
    }

    assert.strictEqual(successCount, 1000);
    assert.strictEqual(failures.length, 0);
  });

  it("produces deterministic output for fixed input", async () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const { nodes, edges } = generateRandomGraph(5);

    const result1 = await useCase.execute(nodes, edges, "TB");
    const result2 = await useCase.execute(nodes, edges, "TB");

    assert.deepStrictEqual(result1.positions, result2.positions);
  });

  it("respects direction parameter (TB vs LR)", async () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const { nodes, edges } = generateRandomGraph(5);

    const resultTB = await useCase.execute(nodes, edges, "TB");
    const resultLR = await useCase.execute(nodes, edges, "LR");

    assert.ok(resultTB.positions !== undefined);
    assert.ok(resultLR.positions !== undefined);
    assert.deepStrictEqual(
      resultTB.positions.length,
      resultLR.positions.length,
    );
  });

  it("handles edge cases: empty graph", async () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const result = await useCase.execute([], [], "TB");

    assert.deepStrictEqual(result.positions, []);
  });

  it("handles edge cases: single node, no edges", async () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const result = await useCase.execute(
      [{ id: "n0", width: 100, height: 100 }],
      [],
      "TB",
    );

    assert.strictEqual(result.positions.length, 1);
    assert.strictEqual(result.positions[0].nodeId, "n0");
  });

  it("handles edge cases: disconnected components", async () => {
    const fakePort = new GraphLayoutPortFake();
    const useCase = new SolveGraphLayoutUseCase(fakePort);

    const nodes = [
      { id: "n0", width: 100, height: 100 },
      { id: "n1", width: 100, height: 100 },
      { id: "n2", width: 100, height: 100 },
      { id: "n3", width: 100, height: 100 },
    ];

    const edges = [
      { source: "n0", target: "n1" },
      { source: "n2", target: "n3" },
    ];

    const result = await useCase.execute(nodes, edges, "TB");

    assert.strictEqual(result.positions.length, 4);
    for (const pos of result.positions) {
      assert.strictEqual(Number.isFinite(pos.x), true);
      assert.strictEqual(Number.isFinite(pos.y), true);
    }
  });
});
