import type { GestureParserPort } from "../ports/in/gesture-parser.port";
import type { Gesture } from "../../domain/gesture";
import type { ParsedGesture } from "../../domain/value-objects/parsed-gesture";

export class ParseGestureUseCase {
  constructor(private readonly gestureParser: GestureParserPort) {}

  execute(gesture: Gesture): ParsedGesture {
    return this.gestureParser.parse(gesture);
  }
}
