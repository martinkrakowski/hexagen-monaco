import type {
  LayoutConstraint,
  LayoutConstraintType,
  LayoutConstraintPayload,
  MinDistancePayload,
  MaxDistancePayload,
  AlignmentPayload,
  ContainmentPayload,
  AspectRatioPayload,
  GroupBoundaryPayload,
} from "../../src/domain/value-objects/layout-constraint.js";
import type { LayoutResult } from "../../src/domain/value-objects/layout-result.js";
import { DagreLayoutSolverAdapter } from "../../src/infrastructure/adapters/dagre-layout-solver.adapter.js";

function randomId(): string {
  return `c-${Math.random().toString(36).slice(2, 9)}`;
}

function randomAxis(): "x" | "y" | "both" {
  const axes = ["x", "y", "both"] as const;
  return axes[Math.floor(Math.random() * axes.length)];
}

function randomPixels(min: number = 50, max: number = 400): number {
  return min + Math.floor(Math.random() * (max - min));
}

function randomMinDistancePayload(): MinDistancePayload {
  return {
    axis: randomAxis(),
    minPixels: randomPixels(50, 400),
  };
}

function randomMaxDistancePayload(): MaxDistancePayload {
  return {
    axis: randomAxis(),
    maxPixels: randomPixels(50, 400),
  };
}

function randomAlignmentPayload(): AlignmentPayload {
  return {
    axis: Math.random() < 0.5 ? "x" : "y",
    offset: randomPixels(-100, 100),
  };
}

function randomContainmentPayload(): ContainmentPayload {
  return {
    containerId: `container-${randomId()}`,
    padding: randomPixels(0, 100),
  };
}

function randomAspectRatioPayload(): AspectRatioPayload {
  const ratios = [1, 1.5, 2, 0.5, 16 / 9, 4 / 3];
  return {
    ratio: ratios[Math.floor(Math.random() * ratios.length)],
  };
}

function randomGroupBoundaryPayload(): GroupBoundaryPayload {
  return {
    width: randomPixels(400, 1200),
    height: randomPixels(400, 1200),
    centerX: randomPixels(100, 800),
    centerY: randomPixels(100, 600),
  };
}

function randomConstraintType(): LayoutConstraintType {
  const types: LayoutConstraintType[] = [
    "min-distance",
    "max-distance",
    "alignment",
    "containment",
    "aspect-ratio",
    "group-boundary",
  ];
  return types[Math.floor(Math.random() * types.length)];
}

function randomConstraintPayload(
  type: LayoutConstraintType,
): LayoutConstraintPayload {
  switch (type) {
    case "min-distance":
      return randomMinDistancePayload();
    case "max-distance":
      return randomMaxDistancePayload();
    case "alignment":
      return randomAlignmentPayload();
    case "containment":
      return randomContainmentPayload();
    case "aspect-ratio":
      return randomAspectRatioPayload();
    case "group-boundary":
      return randomGroupBoundaryPayload();
  }
}

function randomConstraint(): LayoutConstraint {
  const type = randomConstraintType();
  return {
    id: randomId(),
    type,
    payload: randomConstraintPayload(type),
  };
}

function generateRandomConstraints(count: number): LayoutConstraint[] {
  const constraints: LayoutConstraint[] = [];
  for (let i = 0; i < count; i++) {
    constraints.push(randomConstraint());
  }
  return constraints;
}

function generateNodeCount(): number {
  return 1 + Math.floor(Math.random() * 20);
}

function runFeasibilityScenario(
  constraints: LayoutConstraint[],
  nodeCount: number,
): LayoutResult {
  const solver = new DagreLayoutSolverAdapter();
  return solver.solve(constraints, nodeCount);
}

describe("Property: Layout feasibility can be determined for random constraints", () => {
  const NUM_RUNS = 1200;

  it("should handle 1200 random constraint combinations without crashing", () => {
    let errors = 0;
    let successCount = 0;
    let failureCount = 0;

    for (let run = 0; run < NUM_RUNS; run++) {
      const constraintCount = Math.floor(Math.random() * 8);
      const constraints = generateRandomConstraints(constraintCount);
      const nodeCount = generateNodeCount();

      try {
        const result = runFeasibilityScenario(constraints, nodeCount);
        if (result.success) {
          successCount++;
          if (result.positions.length !== nodeCount) {
            errors++;
          }
        } else {
          failureCount++;
          if (!Array.isArray(result.violations)) {
            errors++;
          }
        }
      } catch {
        errors++;
      }
    }

    expect(errors).toBe(0);
    expect(successCount + failureCount).toBe(NUM_RUNS);
  });

  it("empty constraints should always produce a valid layout", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const nodeCount = generateNodeCount();
      const result = runFeasibilityScenario([], nodeCount);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.positions).toHaveLength(nodeCount);
      }
    }
  });

  it("single min-distance constraint should produce valid layout", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const constraint: LayoutConstraint = {
        id: randomId(),
        type: "min-distance",
        payload: { axis: randomAxis(), minPixels: randomPixels(50, 400) },
      };
      const nodeCount = generateNodeCount();
      const result = runFeasibilityScenario([constraint], nodeCount);
      expect(result).toBeDefined();
      if (result.success) {
        expect(result.positions).toHaveLength(nodeCount);
      }
    }
  });

  it("group-boundary constraint should produce valid layout", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const constraint: LayoutConstraint = {
        id: randomId(),
        type: "group-boundary",
        payload: randomGroupBoundaryPayload(),
      };
      const nodeCount = generateNodeCount();
      const result = runFeasibilityScenario([constraint], nodeCount);
      expect(result).toBeDefined();
      if (result.success) {
        expect(result.positions).toHaveLength(nodeCount);
      }
    }
  });

  it("multiple constraints should produce deterministic results", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const constraintCount = 3 + Math.floor(Math.random() * 5);
      const constraints = generateRandomConstraints(constraintCount);
      const nodeCount = generateNodeCount();

      const result1 = runFeasibilityScenario(constraints, nodeCount);
      const result2 = runFeasibilityScenario(constraints, nodeCount);

      expect(result1.success).toBe(result2.success);

      if (result1.success && result2.success) {
        expect(result1.positions.length).toBe(result2.positions.length);
        for (let i = 0; i < result1.positions.length; i++) {
          expect(result1.positions[i].nodeId).toBe(result2.positions[i].nodeId);
        }
      }
    }
  });

  it("layout positions should have valid coordinates", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const constraintCount = Math.floor(Math.random() * 6);
      const constraints = generateRandomConstraints(constraintCount);
      const nodeCount = generateNodeCount();

      const result = runFeasibilityScenario(constraints, nodeCount);

      if (result.success) {
        for (const pos of result.positions) {
          expect(typeof pos.x).toBe("number");
          expect(typeof pos.y).toBe("number");
          expect(typeof pos.width).toBe("number");
          expect(typeof pos.height).toBe("number");
          expect(pos.width).toBeGreaterThan(0);
          expect(pos.height).toBeGreaterThan(0);
        }
      }
    }
  });

  it("containment constraints should be handled", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const constraint: LayoutConstraint = {
        id: randomId(),
        type: "containment",
        payload: randomContainmentPayload(),
      };
      const nodeCount = generateNodeCount();
      const result = runFeasibilityScenario([constraint], nodeCount);
      expect(result).toBeDefined();
    }
  });

  it("alignment constraints should be handled", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const constraint: LayoutConstraint = {
        id: randomId(),
        type: "alignment",
        payload: randomAlignmentPayload(),
      };
      const nodeCount = generateNodeCount();
      const result = runFeasibilityScenario([constraint], nodeCount);
      expect(result).toBeDefined();
    }
  });

  it("aspect-ratio constraints should be handled", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const constraint: LayoutConstraint = {
        id: randomId(),
        type: "aspect-ratio",
        payload: randomAspectRatioPayload(),
      };
      const nodeCount = generateNodeCount();
      const result = runFeasibilityScenario([constraint], nodeCount);
      expect(result).toBeDefined();
    }
  });

  it("max-distance constraints should be handled", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const constraint: LayoutConstraint = {
        id: randomId(),
        type: "max-distance",
        payload: randomMaxDistancePayload(),
      };
      const nodeCount = generateNodeCount();
      const result = runFeasibilityScenario([constraint], nodeCount);
      expect(result).toBeDefined();
    }
  });
});
