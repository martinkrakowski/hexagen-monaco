import { RejectEmitter } from "../src/reject-emitter.js";

describe("RejectEmitter", () => {
  let emitter: RejectEmitter;

  beforeEach(() => {
    emitter = new RejectEmitter();
  });

  describe("emit()", () => {
    it("should create a rejection with generated ID", () => {
      const rejection = emitter.emit("Test reason");

      expect(rejection.id).toBeDefined();
      expect(typeof rejection.id).toBe("string");
      expect(rejection.reason).toBe("Test reason");
      expect(rejection.severity).toBe("error");
    });

    it("should create a rejection with custom severity", () => {
      const rejection = emitter.emit("Test reason", "warning");

      expect(rejection.severity).toBe("warning");
    });

    it("should create a rejection with gestureId", () => {
      const gestureId = "test-gesture-id";
      const rejection = emitter.emit("Test reason", "error", gestureId);

      expect(rejection.gestureId).toBe(gestureId);
    });
  });

  describe("emitTopologyViolation()", () => {
    it("should create a rejection from an Acyclic violation", () => {
      const rejection = emitter.emitTopologyViolation(
        {
          type: "Acyclic",
          payload: { appliesTo: ["Command"] },
        },
        "gesture-1",
      );

      expect(rejection.severity).toBe("error");
      expect(rejection.invariantType).toBe("Acyclic");
      expect(rejection.gestureId).toBe("gesture-1");
      expect(rejection.reason).toContain("Cycle detected");
    });

    it("should create a rejection from a Connected violation", () => {
      const rejection = emitter.emitTopologyViolation({
        type: "Connected",
        payload: { edgeKinds: ["Command"], rootNodeKinds: ["Aggregate"] },
      });

      expect(rejection.invariantType).toBe("Connected");
      expect(rejection.reason).toContain("not connected");
    });
  });

  describe("emitCardinalityViolation()", () => {
    it("should create a rejection from an Exactly violation", () => {
      const rejection = emitter.emitCardinalityViolation({
        type: "Exactly",
        payload: { nodeKind: "Aggregate", count: 1 },
      });

      expect(rejection.invariantType).toBe("Exactly");
      expect(rejection.reason).toContain("exactly");
    });

    it("should create a rejection from an AtLeast violation", () => {
      const rejection = emitter.emitCardinalityViolation({
        type: "AtLeast",
        payload: { nodeKind: "Aggregate", count: 2 },
      });

      expect(rejection.invariantType).toBe("AtLeast");
      expect(rejection.reason).toContain("at least");
    });
  });
});
