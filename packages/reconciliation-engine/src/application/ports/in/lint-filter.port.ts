import type { LinterReportLike } from "@hexagen/core-domain";
import type { Patch } from "../../../domain/llm-response.js";

/**
 * Port for filtering patches based on linter report violations.
 * Implementations determine which patches to accept or reject
 * based on lint severity, file paths, and custom rules.
 */
export interface LintFilterPort {
  shouldAccept(patch: Patch, report: LinterReportLike): boolean;
}
