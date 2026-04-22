import { DetectViolationsUseCase } from "../src/application/use-cases/detect-violations.use-case.js";
import { FakeDetectViolationsAdapter } from "./doubles/fake-detect-violations.ts";
import type { LayoutConstraint } from "../src/domain/value-objects/layout-constraint.js";
import type {
  LayoutPosition,
  LayoutViolation,
} from "../src/domain/value-objects/layout-result.js";

describe("DetectViolationsUseCase", () => {
  let fake: FakeDetectViolationsAdapter;
  let useCase: DetectViolationsUseCase;

  beforeEach(() => {
    fake = new FakeDetectViolationsAdapter();
    useCase = new DetectViolationsUseCase(fake);
  });

  const positions: LayoutPosition[] = [
    { nodeId: "n1", x: 0, y: 0, width: 100, height: 100 },
  ];
  const constraints: LayoutConstraint[] = [
    { id: "c1", type: "min-distance", payload: { axis: "x", minPixels: 50 } },
  ];

  it("delegates to the detector port", () => {
    useCase.execute(positions, constraints);
    expect(fake.callCount).toBe(1);
    expect(fake.lastPositions).toBe(positions);
    expect(fake.lastConstraints).toBe(constraints);
  });

  it("returns no violations by default", () => {
    const result = useCase.execute(positions, constraints);
    expect(result).toEqual([]);
  });

  it("returns forced violations", () => {
    const forcedViolations: LayoutViolation[] = [
      {
        constraintId: "c1",
        constraintType: "min-distance",
        message: "too close",
        severity: "warning",
      },
    ];
    fake.forceViolations(forcedViolations);
    const result = useCase.execute(positions, constraints);
    expect(result).toHaveLength(1);
    expect(result[0].constraintId).toBe("c1");
  });
});
