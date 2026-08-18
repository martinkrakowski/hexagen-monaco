import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Manifest } from "../../types/manifest.js";
import { parseReportBaseline } from "./baseline-read.js";
import {
  contextCount,
  generateContextMapMermaid,
  systemNameOf,
} from "./context-map.js";
import { collectRatchetTrend } from "./ratchet-trend.js";
import type {
  DriftSummary,
  EngagementReport,
  GitReader,
  LintCollector,
} from "./types.js";

export const DEFAULT_BASELINE_REL = ".architecture/arch-lint-baseline.json";
export const DEFAULT_LAYOUT_REL = ".architecture/layout.yaml";

const EMPTY_DRIFT: DriftSummary = {
  fresh: [],
  baselined: [],
  stale: [],
  expired: [],
  collected: false,
};

export function buildEngagementReport(input: {
  workspaceRoot: string;
  manifest: Manifest;
  generatedAt?: string;
  git: GitReader;
  lint?: LintCollector;
  now?: Date;
}): EngagementReport {
  const baselinePath = path.join(input.workspaceRoot, DEFAULT_BASELINE_REL);
  const layoutPath = path.join(input.workspaceRoot, DEFAULT_LAYOUT_REL);
  const baselinePresent = existsSync(baselinePath);
  let suppressions: EngagementReport["suppressions"] = [];
  if (baselinePresent) {
    suppressions = parseReportBaseline(
      readFileSync(baselinePath, "utf8"),
    ).entries;
  }

  const drift = input.lint?.collect() ?? EMPTY_DRIFT;
  const trend = baselinePresent
    ? collectRatchetTrend(input.git, DEFAULT_BASELINE_REL)
    : [];

  return {
    generatedAt: input.generatedAt ?? (input.now ?? new Date()).toISOString(),
    workspaceRoot: input.workspaceRoot,
    systemName: systemNameOf(input.manifest),
    mermaid: generateContextMapMermaid(input.manifest),
    contextCount: contextCount(input.manifest),
    drift,
    trend,
    suppressions,
    baselinePresent,
    layoutPresent: existsSync(layoutPath),
  };
}
