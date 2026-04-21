import { EmitRejectionUseCase } from "../src/application/use-cases/emit-rejection.use-case";
import { Rejection } from "../src/domain/rejection";
import { FakeRejectEmitter } from "./doubles/fake-reject-emitter";

describe("EmitRejectionUseCase (port-based contract)", () => {
  let fakeEmitter: FakeRejectEmitter;
  let useCase: EmitRejectionUseCase;

  beforeEach(() => {
    fakeEmitter = new FakeRejectEmitter();
    useCase = new EmitRejectionUseCase(fakeEmitter);
  });

  describe("execute()", () => {
    it("should delegate to RejectEmitterPort", () => {
      const rejection = new Rejection("Test reason");

      useCase.execute(rejection);

      expect(fakeEmitter.emitCount).toBe(1);
      expect(fakeEmitter.lastRejection).toBe(rejection);
    });

    it("should emit multiple rejections in order", () => {
      const first = new Rejection("First");
      const second = new Rejection("Second");

      useCase.execute(first);
      useCase.execute(second);

      expect(fakeEmitter.emitCount).toBe(2);
      expect(fakeEmitter.emitted[0]).toBe(first);
      expect(fakeEmitter.emitted[1]).toBe(second);
    });

    it("should record the rejection reason", () => {
      const rejection = new Rejection("Topology violation");

      useCase.execute(rejection);

      expect(fakeEmitter.lastRejection?.reason).toBe("Topology violation");
    });
  });
});
