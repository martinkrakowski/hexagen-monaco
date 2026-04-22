import type { GestureParserPort } from "../ports/in/gesture-parser.port.js";
import type { Gesture } from "../../domain/gesture.js";
import type { ParsedGesture } from "../../domain/value-objects/parsed-gesture.js";

export class ParseGestureUseCase {
  constructor(private readonly gestureParser: GestureParserPort) {}

  execute(gesture: Gesture): ParsedGesture {
    return this.gestureParser.parse(gesture);
  }
}
