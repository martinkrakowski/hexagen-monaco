import type { Result } from "@hexagen/shared";
import { ok, err } from "@hexagen/shared";

export type LocalModelState =
  | "NOT_DOWNLOADED"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "LOADING"
  | "ACTIVE"
  | "ERROR";

export const LOCAL_MODEL_STATES = {
  NOT_DOWNLOADED: "NOT_DOWNLOADED",
  DOWNLOADING: "DOWNLOADING",
  DOWNLOADED: "DOWNLOADED",
  LOADING: "LOADING",
  ACTIVE: "ACTIVE",
  ERROR: "ERROR",
} as const;

export type LocalModelEvent =
  | "START_DOWNLOAD"
  | "DOWNLOAD_PROGRESS"
  | "DOWNLOAD_SUCCESS"
  | "DOWNLOAD_FAIL"
  | "START_LOAD"
  | "LOAD_SUCCESS"
  | "LOAD_FAIL"
  | "UNLOAD"
  | "CRASH"
  | "DELETE"
  | "RESET"
  | "RETRY_DOWNLOAD"
  | "RETRY_LOAD";

export class LocalModelStateMachine {
  /**
   * Validates if a state is a canonical LocalModelState.
   */
  static isValidState(state: string): state is LocalModelState {
    return state in LOCAL_MODEL_STATES;
  }

  /**
   * Transitions local model state safely based on defined lifecycle rules.
   */
  static transition(
    currentState: LocalModelState,
    event: LocalModelEvent,
  ): Result<LocalModelState> {
    try {
      switch (currentState) {
        case "NOT_DOWNLOADED":
          if (event === "START_DOWNLOAD") return ok("DOWNLOADING");
          break;

        case "DOWNLOADING":
          if (event === "DOWNLOAD_PROGRESS") return ok("DOWNLOADING");
          if (event === "DOWNLOAD_SUCCESS") return ok("DOWNLOADED");
          if (event === "DOWNLOAD_FAIL") return ok("ERROR");
          break;

        case "DOWNLOADED":
          if (event === "START_LOAD") return ok("LOADING");
          if (event === "DELETE") return ok("NOT_DOWNLOADED");
          break;

        case "LOADING":
          if (event === "LOAD_SUCCESS") return ok("ACTIVE");
          if (event === "LOAD_FAIL") return ok("ERROR");
          break;

        case "ACTIVE":
          if (event === "UNLOAD") return ok("DOWNLOADED");
          if (event === "CRASH") return ok("ERROR");
          if (event === "DELETE") return ok("NOT_DOWNLOADED");
          break;

        case "ERROR":
          if (event === "RESET") return ok("NOT_DOWNLOADED");
          if (event === "RETRY_DOWNLOAD") return ok("DOWNLOADING");
          if (event === "RETRY_LOAD") return ok("LOADING");
          break;

        default:
          return err(new Error(`Unknown current state: ${currentState}`));
      }

      return err(
        new Error(
          `Invalid transition from state ${currentState} with event ${event}`,
        ),
      );
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
