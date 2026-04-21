import { GestureParserPort } from "../ports/in/gesture-parser.port";
import { Gesture } from "../../domain/gesture";
import { ParsedGesture } from "../../domain/value-objects/parsed-gesture";

export class ParseGestureUseCase {
  constructor(private readonly gestureParser: GestureParserPort) {}

  execute(gesture: Gesture): ParsedGesture {
    return this.gestureParser.parse(gesture);
  }
}