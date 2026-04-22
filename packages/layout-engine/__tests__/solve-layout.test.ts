import { SolveLayoutUseCase } from "../src/application/use-cases/solve-layout.use-case.js";
import { FakeSolveLayoutAdapter } from "./doubles/fake-solve-layout.ts";

describe("SolveLayoutUseCase", () => {
  let fake: FakeSolveLayoutAdapter;
  let useCase: SolveLayoutUseCase;

  beforeEach(() => {
    fake = new FakeSolveLayoutAdapter();
    useCase = new SolveLayoutUseCase(fake);
  });

  it("delegates to the solver port", () => {
    const constraints = [
      {
        id: "c1",
        type: "min-distance" as const,
        payload: { axis: "both" as const, minPixels: 100 },
      },
    ];
    useCase.execute(constraints, 3);
    expect(fake.callCount).toBe(1);
    expect(fake.lastNodeCount).toBe(3);
    expect(fake.lastConstraints).toBe(constraints);
  });

  it("returns success result from fake by default", () => {
    const result = useCase.execute([], 2);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.positions).toHaveLength(2);
    }
  });

  it("returns forced failure result", () => {
    fake.forceResult({
      success: false,
      violations: [
        {
          constraintId: "c1",
          constraintType: "overlap",
          message: "overlap",
          severity: "error",
        },
      ],
    });
    const result = useCase.execute([], 2);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations).toHaveLength(1);
    }
  });
});
