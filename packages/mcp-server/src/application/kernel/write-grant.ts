import { checkWriteAgainstGrant, type WriteRef } from "@hexagen/shared";

/**
 * The Field Kit scope check lives in `@hexagen/shared` so the `hexagen grant
 * check` CLI runs the very same function; it is re-exported here for the
 * accept path.
 */
export { checkWriteAgainstGrant };
export type { WriteRef };
