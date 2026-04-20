import { DomainAST, Identifier } from "@hexagen/core-domain";

export interface Gesture {
  id: Identifier;
  type: string;
  payload: Record<string, unknown>;
}

export interface ParsedGesture {
  gesture: Gesture;
  ast: DomainAST;
  confidence: number;
}

export class GestureParser {
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
