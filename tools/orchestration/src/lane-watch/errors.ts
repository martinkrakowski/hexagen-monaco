/** Exit codes. 3 is the one a caller must not mistake for success. */
export const EXIT_OK = 0;
/** A request failed, a response was unusable, or the stream ended early. */
export const EXIT_ERROR = 1;
/** The command line was refused, before any network call. */
export const EXIT_USAGE = 2;
/** `usage` could not read every field: the reading is incomplete. */
export const EXIT_UNKNOWN = 3;
/** `follow` saw nothing for its session inside the stall window. */
export const EXIT_STALL = 4;
/** Interrupted from outside (SIGINT or SIGTERM). */
export const EXIT_INTERRUPTED = 130;

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
