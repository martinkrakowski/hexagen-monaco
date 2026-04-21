import { DomainAST, Identifier } from "@hexagen/core-domain";
import { GestureParserPort } from "../../../application/ports/in/gesture-parser.port";
import { Gesture } from "../../../domain/gesture";
import { ParsedGesture } from "../../../domain/value-objects/parsed-gesture";

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