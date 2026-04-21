import type { Gesture } from "../../../domain/gesture";
import type { ParsedGesture } from "../../../domain/value-objects/parsed-gesture";

export interface GestureParserPort {
  parse(gesture: Gesture): ParsedGesture;
}
