import type { Gesture } from "../../../domain/gesture.js";
import type { ParsedGesture } from "../../../domain/value-objects/parsed-gesture.js";

export interface GestureParserPort {
  parse(gesture: Gesture): ParsedGesture;
}
