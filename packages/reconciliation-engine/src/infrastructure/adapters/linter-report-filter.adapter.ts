import type {
  LintFilterPort,
  LinterReportLike,
} from "../../application/ports/in/lint-filter.port.js";
import type { Patch } from "../../domain/llm-response.js";

export class LinterReportFilterAdapter implements LintFilterPort {
  filterPatches(patches: Patch[], report: LinterReportLike): Patch[] {
    if (report.isCompliant) {
      return patches;
    }

    const errorViolations = report.violations.filter(
      (v) => v.severity === "error",
    );

    if (errorViolations.length === 0) {
      return patches;
    }

    const blockedTargets = new Set<string>();
    for (const violation of errorViolations) {
      blockedTargets.add(violation.file);
      const segments = violation.file.split(/[/\\]/);
      if (segments.length >= 2) {
        blockedTargets.add(segments[0]);
        blockedTargets.add(segments.join("/"));
      }
    }

    return patches.filter((patch) => {
      if (blockedTargets.has(patch.targetId)) {
        return false;
      }

      if (
        patch.payload.file &&
        blockedTargets.has(String(patch.payload.file))
      ) {
        return false;
      }

      if (
        patch.payload.target &&
        blockedTargets.has(String(patch.payload.target))
      ) {
        return false;
      }

      return true;
    });
  }
}
