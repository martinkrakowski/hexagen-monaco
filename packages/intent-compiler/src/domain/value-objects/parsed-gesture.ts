import { Gesture } from "../gesture";
import { DomainAST } from "@hexagen/core-domain";

export interface ParsedGesture {
  gesture: Gesture;
  ast: DomainAST;
  confidence: number;
}