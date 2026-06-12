import type { ReportEntryType } from "../migration-report.js";

/**
 * Structural recorder interface the generators write audit entries through.
 * The `type` parameter is the closed vocabulary from migration-report.ts
 * (PR-B1): a generator inventing a new tag is now a compile error at the call
 * site instead of a string silently laundered into the report.
 */
export type ReportRecorder = {
  record: (type: ReportEntryType, target: string, message?: string) => void;
};
