import { Gesture } from "../../domain/gesture";
import { ParsedGesture } from "../../domain/value-objects/parsed-gesture";

export interface GestureParserPort {
  parse(gesture: Gesture): ParsedGesture;
}