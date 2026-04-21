import type { GestureParserPort } from "../../src/application/ports/in/gesture-parser.port";
import type { Gesture } from "../../src/domain/gesture";
import type { ParsedGesture } from "../../src/domain/value-objects/parsed-gesture";
import type { DomainAST } from "@hexagen/core-domain";

export class FakeGestureParser implements GestureParserPort {
  private readonly _defaultAst: DomainAST = {
    nodes: [],
    edges: [],
    invariants: { topology: [], cardinality: [] },
  };
  private _lastGesture: Gesture | null = null;
  private _parseCallCount = 0;

  constructor(
    private readonly confidence: number = 1.0,
    private readonly astOverride?: DomainAST,
  ) {}

  parse(gesture: Gesture): ParsedGesture {
    this._lastGesture = gesture;
    this._parseCallCount++;
    return {
      gesture,
      ast: this.astOverride ?? this._defaultAst,
      confidence: this.confidence,
    };
  }

  get lastGesture(): Gesture | null {
    return this._lastGesture;
  }

  get parseCallCount(): number {
    return this._parseCallCount;
  }
}
