import type { LintFilterPort } from "../../application/ports/in/lint-filter.port.js";
import type { LinterReportLike } from "@hexagen/core-domain";
import type { Patch } from "../../domain/llm-response.js";

/**
 * Adapter that filters patches based on linter report violations.
 * Rejects patches that have error-severity violations in files
 * that match the patch target or payload fields.
 */
export class LinterReportFilterAdapter implements LintFilterPort {
  shouldAccept(patch: Patch, report: LinterReportLike): boolean {
    // Accept patches when report is compliant
    if (report.isCompliant) {
      return true;
    }

    // Collect all files with error-severity violations
    const blockedTargets = new Set<string>();
    for (const violation of report.violations) {
      if (violation.severity === "error") {
        blockedTargets.add(violation.file);
        // Also block parent directories to be conservative
        const segments = violation.file.split(/[/\\]/);
        if (segments.length >= 2) {
          blockedTargets.add(segments[0]);
          blockedTargets.add(segments.join("/"));
        }
      }
    }

    // Reject patches that target blocked files
    if (blockedTargets.has(patch.targetId)) {
      return false;
    }

    if (patch.payload.file && blockedTargets.has(String(patch.payload.file))) {
      return false;
    }

    if (
      patch.payload.target &&
      blockedTargets.has(String(patch.payload.target))
    ) {
      return false;
    }

    return true;
  }
}
