import type { DomainAST } from "@hexagen/core-domain";
import type { GestureParserPort } from "../../application/ports/in/gesture-parser.port.js";
import type { Gesture } from "../../domain/gesture.js";
import type { ParsedGesture } from "../../domain/value-objects/parsed-gesture.js";

export class DefaultGestureParserAdapter implements GestureParserPort {
  parse(gesture: Gesture): ParsedGesture {
    // TODO: Implement gesture parsing logic
    // For now, return a mock AST
    const mockAst: DomainAST = {
      nodes: [],
      edges: [],
      invariants: {
        topology: [],
        cardinality: [],
      },
    };

    return {
      gesture,
      ast: mockAst,
      confidence: 0.8,
    };
  }
}
