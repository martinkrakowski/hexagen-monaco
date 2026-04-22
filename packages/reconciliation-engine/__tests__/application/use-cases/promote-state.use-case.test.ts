import { PromoteStateUseCase } from "../../../src/application/use-cases/promote-state.use-case.js";
import type { PromoteStatePort } from "../../../src/application/ports/in/promote-state.port.js";
import type { ReconciliationState } from "../../../src/domain/reconciliation-state.js";

describe("PromoteStateUseCase", () => {
  let promoteStatePort: PromoteStatePort;
  let useCase: PromoteStateUseCase;

  beforeEach(() => {
    promoteStatePort = {
      promoteState: jest.fn(),
    };
    useCase = new PromoteStateUseCase(promoteStatePort);
  });

  it("should delegate to the promoteStatePort", () => {
    const state: ReconciliationState = {
      version: 0,
      lastUpdated: 1000,
      isStable: true,
      conflictCount: 0,
      pendingVerdicts: [],
    };
    const verdictId = "verdict-1";
    const expectedResult: ReconciliationState = {
      version: 1,
      lastUpdated: 2000,
      isStable: true,
      conflictCount: 0,
      pendingVerdicts: [],
    };

    promoteStatePort.promoteState.mockReturnValue(expectedResult);

    const result = useCase.execute(state, verdictId);

    expect(result).toEqual(expectedResult);
    expect(promoteStatePort.promoteState).toHaveBeenCalledWith(
      state,
      verdictId,
    );
  });
});
