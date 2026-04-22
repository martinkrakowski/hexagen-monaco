import { ScoreStabilityUseCase } from "../src/application/use-cases/score-stability.use-case.js";
import { FakeScoreStabilityAdapter } from "./doubles/fake-score-stability.ts";
import type { LayoutConstraint } from "../src/domain/value-objects/layout-constraint.js";
import type { LayoutPosition } from "../src/domain/value-objects/layout-result.js";
import type { StabilityScore } from "../src/domain/value-objects/stability-score.js";

describe("ScoreStabilityUseCase", () => {
  let fake: FakeScoreStabilityAdapter;
  let useCase: ScoreStabilityUseCase;

  beforeEach(() => {
    fake = new FakeScoreStabilityAdapter();
    useCase = new ScoreStabilityUseCase(fake);
  });

  const positions: LayoutPosition[] = [
    { nodeId: "n1", x: 0, y: 0, width: 100, height: 100 },
  ];
  const constraints: LayoutConstraint[] = [
    { id: "c1", type: "min-distance", payload: { axis: "x", minPixels: 50 } },
  ];

  it("delegates to the scorer port", () => {
    useCase.execute(positions, constraints);
    expect(fake.callCount).toBe(1);
    expect(fake.lastPositions).toBe(positions);
    expect(fake.lastConstraints).toBe(constraints);
  });

  it("returns perfect score by default", () => {
    const result = useCase.execute(positions, constraints);
    expect(result.value).toBe(1);
    expect(result.violations).toBe(0);
  });

  it("returns forced score", () => {
    const forcedScore: StabilityScore = {
      value: 0.5,
      violations: 2,
      satisfiedConstraints: 2,
      totalConstraints: 4,
    };
    fake.forceScore(forcedScore);
    const result = useCase.execute(positions, constraints);
    expect(result.value).toBe(0.5);
    expect(result.violations).toBe(2);
  });
});
