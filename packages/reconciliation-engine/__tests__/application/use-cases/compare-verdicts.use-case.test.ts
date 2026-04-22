import { CompareVerdictsUseCase } from "../../../src/application/use-cases/compare-verdicts.use-case.js";
import type { CompareVerdictsPort } from "../../../src/application/ports/in/compare-verdicts.port.js";
import type { Verdict } from "../../../src/domain/verdict.js";

describe("CompareVerdictsUseCase", () => {
  let compareVerdictsPort: CompareVerdictsPort;
  let useCase: CompareVerdictsUseCase;

  beforeEach(() => {
    compareVerdictsPort = {
      compareVerdicts: jest.fn(),
    };
    useCase = new CompareVerdictsUseCase(compareVerdictsPort);
  });

  it("should delegate to the compareVerdictsPort", () => {
    const verdictA: Verdict = {
      id: "verdict-1",
      patchId: "patch-1",
      accepted: true,
      reason: "Reason A",
      timestamp: 1000,
    };

    const verdictB: Verdict = {
      id: "verdict-2",
      patchId: "patch-2",
      accepted: false,
      reason: "Reason B",
      timestamp: 2000,
    };

    const expectedResult = 1;
    compareVerdictsPort.compareVerdicts.mockReturnValue(expectedResult);

    const result = useCase.execute(verdictA, verdictB);

    expect(result).toBe(expectedResult);
    expect(compareVerdictsPort.compareVerdicts).toHaveBeenCalledWith(
      verdictA,
      verdictB,
    );
  });
});
