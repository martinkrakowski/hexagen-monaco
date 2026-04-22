import type { Gesture } from "../gesture.js";
import type { DomainAST } from "@hexagen/core-domain";

export interface ParsedGesture {
  gesture: Gesture;
  ast: DomainAST;
  confidence: number;
}
