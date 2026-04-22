import { ResolveConflictUseCase } from "../../../src/application/use-cases/resolve-conflict.use-case.js";
import type { ResolveConflictPort } from "../../../src/application/ports/in/resolve-conflict.port.js";
import type { Patch } from "../../../src/domain/llm-response.js";

describe("ResolveConflictUseCase", () => {
  let resolveConflictPort: ResolveConflictPort;
  let useCase: ResolveConflictUseCase;

  beforeEach(() => {
    resolveConflictPort = {
      resolveConflict: jest.fn(),
    };
    useCase = new ResolveConflictUseCase(resolveConflictPort);
  });

  it("should delegate to the resolveConflictPort", () => {
    const patchA: Patch = {
      id: "patch-a",
      type: "add_node",
      targetId: "node-1",
      payload: { kind: "Entity" },
    };
    const patchB: Patch = {
      id: "patch-b",
      type: "remove_node",
      targetId: "node-2",
      payload: {},
    };
    const expectedResult: Patch = {
      id: "patch-result",
      type: "add_node",
      targetId: "node-3",
      payload: { kind: "ValueObject" },
    };

    resolveConflictPort.resolveConflict.mockReturnValue(expectedResult);

    const result = useCase.execute(patchA, patchB);

    expect(result).toEqual(expectedResult);
    expect(resolveConflictPort.resolveConflict).toHaveBeenCalledWith(
      patchA,
      patchB,
    );
  });
});
