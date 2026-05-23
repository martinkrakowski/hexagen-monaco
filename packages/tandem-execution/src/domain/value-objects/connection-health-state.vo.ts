import type { Result } from "@hexagen/shared";
import { ok, err } from "@hexagen/shared";

export type ConnectionHealthState =
  | "VALID"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "UNVALIDATED";

export const CONNECTION_HEALTH_STATES = {
  VALID: "VALID",
  DEGRADED: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
  UNVALIDATED: "UNVALIDATED",
} as const;

export class ConnectionHealthStateMachine {
  /**
   * Validates if a state is a canonical ConnectionHealthState.
   */
  static isValidState(state: string): state is ConnectionHealthState {
    return state in CONNECTION_HEALTH_STATES;
  }

  /**
   * Transitions connection health state safely.
   */
  static transition(
    currentState: ConnectionHealthState,
    event: "VALIDATE_SUCCESS" | "VALIDATE_DEGRADED" | "VALIDATE_FAIL" | "RESET",
  ): Result<ConnectionHealthState> {
    try {
      switch (event) {
        case "VALIDATE_SUCCESS":
          return ok("VALID");
        case "VALIDATE_DEGRADED":
          return ok("DEGRADED");
        case "VALIDATE_FAIL":
          return ok("UNAVAILABLE");
        case "RESET":
          return ok("UNVALIDATED");
        default:
          return err(new Error(`Invalid transition event: ${event}`));
      }
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
