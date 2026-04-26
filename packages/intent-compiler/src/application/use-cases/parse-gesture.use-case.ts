import type { GestureParserPort } from "../ports/in/gesture-parser.port.js";
import type { TopologyCheckerPort } from "../ports/in/topology-checker.port.js";
import type { CardinalityCheckerPort } from "../ports/in/cardinality-checker.port.js";
import type { RejectEmitterPort } from "../ports/in/reject-emitter.port.js";
import type { Gesture } from "../../domain/gesture.js";
import type { ParsedGesture } from "../../domain/value-objects/parsed-gesture.js";
import { Rejection } from "../../domain/rejection.js";

/**
 * ParseGestureUseCase
 *
 * Orchestrates the full intent compilation pipeline:
 * 1. Parse the gesture into a structured ParsedGesture with DomainAST
 * 2. Validate the AST against topology invariants
 * 3. Validate the AST against cardinality invariants
 * 4. Emit any rejections encountered
 * 5. Return the ParsedGesture if all validations pass
 *
 * If any validation fails, the rejection is emitted and a Rejection
 * is thrown to indicate the parsing failed.
 */
export class ParseGestureUseCase {
  constructor(
    private readonly gestureParser: GestureParserPort,
    private readonly topologyChecker: TopologyCheckerPort,
    private readonly cardinalityChecker: CardinalityCheckerPort,
    private readonly rejectEmitter: RejectEmitterPort,
  ) {}

  /**
   * Execute the full parsing and validation pipeline
   * @param gesture - The UI interaction to parse
   * @returns ParsedGesture if all validations pass
   * @throws Rejection if any validation fails
   */
  execute(gesture: Gesture): ParsedGesture {
    // Step 1: Parse the gesture
    const parsed = this.gestureParser.parse(gesture);

    // Step 2: Validate topology invariants
    const topologyResult = this.topologyChecker.check(parsed.ast);
    if (!topologyResult.isValid) {
      const rejection = new Rejection(
        `Topology validation failed: ${topologyResult.violations.join("; ")}`,
      );
      this.rejectEmitter.emit(rejection);
      throw rejection;
    }

    // Step 3: Validate cardinality invariants
    const cardinalityResult = this.cardinalityChecker.check(parsed.ast);
    if (!cardinalityResult.isValid) {
      const rejection = new Rejection(
        `Cardinality validation failed: ${cardinalityResult.violations.join("; ")}`,
      );
      this.rejectEmitter.emit(rejection);
      throw rejection;
    }

    // Step 4: All validations passed, return the parsed gesture
    return parsed;
  }
}
