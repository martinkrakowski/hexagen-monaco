import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_BASELINE_REL, DEFAULT_LAYOUT_REL } from "./build-report.js";
import { renderReportHtml } from "./render-html.js";
import { renderReportMarkdown } from "./render-markdown.js";
import type { EngagementReport } from "./types.js";
import { writeZipStore } from "./zip-store.js";

export function buildHandoffZip(
  report: EngagementReport,
  workspaceRoot: string,
): Buffer {
  const entries: { name: string; content: string }[] = [
    { name: "hexagen-report.md", content: renderReportMarkdown(report) },
    { name: "hexagen-report.html", content: renderReportHtml(report) },
    {
      name: "suppression-ledger.json",
      content: `${JSON.stringify({ entries: report.suppressions }, null, 2)}\n`,
    },
  ];

  const manifestPath = path.join(
    workspaceRoot,
    ".architecture",
    "manifest.yaml",
  );
  if (existsSync(manifestPath)) {
    entries.push({
      name: "manifest.yaml",
      content: readFileSync(manifestPath, "utf8"),
    });
  }
  const layoutPath = path.join(workspaceRoot, DEFAULT_LAYOUT_REL);
  if (existsSync(layoutPath)) {
    entries.push({
      name: "layout.yaml",
      content: readFileSync(layoutPath, "utf8"),
    });
  }
  const baselinePath = path.join(workspaceRoot, DEFAULT_BASELINE_REL);
  if (existsSync(baselinePath)) {
    entries.push({
      name: "arch-lint-baseline.json",
      content: readFileSync(baselinePath, "utf8"),
    });
  }

  return writeZipStore(entries);
}
