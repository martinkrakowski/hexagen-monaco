import { ParseGestureUseCase } from "../src/application/use-cases/parse-gesture.use-case";
import { Gesture } from "../src/domain/gesture";
import type { Identifier } from "@hexagen/shared";
import { FakeGestureParser } from "./doubles/fake-gesture-parser";
import type { DomainAST } from "@hexagen/core-domain";

describe("ParseGestureUseCase (port-based contract)", () => {
  let fakeParser: FakeGestureParser;
  let useCase: ParseGestureUseCase;

  beforeEach(() => {
    fakeParser = new FakeGestureParser(0.8);
    useCase = new ParseGestureUseCase(fakeParser);
  });

  describe("execute()", () => {
    it("should delegate to GestureParserPort and return ParsedGesture", () => {
      const gesture = new Gesture("test-gesture-1" as Identifier, "TAP", {
        x: 100,
        y: 200,
      });

      const result = useCase.execute(gesture);

      expect(result.gesture).toBe(gesture);
      expect(result.ast).toBeDefined();
      expect(result.ast.nodes).toEqual([]);
      expect(result.ast.edges).toEqual([]);
      expect(result.ast.invariants).toBeDefined();
      expect(result.confidence).toBe(0.8);
    });

    it("should pass the gesture to the port exactly once", () => {
      const gesture = new Gesture("test-gesture-2" as Identifier, "DRAG", {
        dx: 10,
        dy: 5,
      });

      useCase.execute(gesture);

      expect(fakeParser.parseCallCount).toBe(1);
      expect(fakeParser.lastGesture).toBe(gesture);
    });

    it("should return the AST from the port", () => {
      const customAst: DomainAST = {
        nodes: [{ id: "n1", kind: "Entity" as const, attributes: {} }],
        edges: [],
        invariants: { topology: [], cardinality: [] },
      };
      const parserWithAst = new FakeGestureParser(1.0, customAst);
      const uc = new ParseGestureUseCase(parserWithAst);
      const gesture = new Gesture("g1" as Identifier, "PINCH", {});

      const result = uc.execute(gesture);

      expect(result.ast).toBe(customAst);
    });
  });
});
