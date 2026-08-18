import type { EngagementReport } from "./types.js";

function trendSpark(counts: number[]): string {
  if (counts.length === 0) return "(no history)";
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const blocks = "▁▂▃▄▅▆▇█";
  return counts
    .slice()
    .reverse()
    .map((n) => {
      if (max === min) return blocks[0];
      const idx = Math.round(((n - min) / (max - min)) * (blocks.length - 1));
      return blocks[idx] ?? blocks[0];
    })
    .join("");
}

export function renderReportMarkdown(report: EngagementReport): string {
  const lines: string[] = [];
  lines.push(`# Hexagen engagement report — ${report.systemName}`);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Workspace: \`${report.workspaceRoot}\``);
  lines.push(
    `Contexts: ${report.contextCount} · Baseline: ${report.baselinePresent ? "present" : "absent"} · layout.yaml: ${report.layoutPresent ? "present" : "absent"}`,
  );
  lines.push("");
  lines.push("## Context map");
  lines.push("");
  lines.push("```mermaid");
  lines.push(report.mermaid.trimEnd());
  lines.push("```");
  lines.push("");
  lines.push("## Drift vs baseline");
  lines.push("");
  if (!report.drift.collected) {
    const why =
      report.drift.failureReason ??
      "hexagen-lint missing, unbuilt, or failed to start";
    lines.push(
      `Live linter output was not collected (${why}). The suppression ledger below is still the committed baseline.`,
    );
  } else {
    lines.push(`| Fresh (regressions) | Suppressed | Stale | Expired |`);
    lines.push(`| ---: | ---: | ---: | ---: |`);
    lines.push(
      `| ${report.drift.fresh.length} | ${report.drift.baselined.length} | ${report.drift.stale.length} | ${report.drift.expired.length} |`,
    );
    if (report.drift.fresh.length > 0) {
      lines.push("");
      lines.push("### Fresh violations");
      for (const v of report.drift.fresh) {
        const spec = v.specifier ? ` (\`${v.specifier}\`)` : "";
        lines.push(`- \`${v.rule}\` \`${v.file}\`${spec}`);
      }
    }
    if (report.drift.expired.length > 0) {
      lines.push("");
      lines.push("### Expired suppressions");
      for (const e of report.drift.expired) {
        lines.push(`- \`${e.rule}\` \`${e.file}\` expired ${e.expires ?? "?"}`);
      }
    }
  }
  lines.push("");
  lines.push("## Ratchet trend");
  lines.push("");
  const counts = report.trend.map((p) => p.entryCount);
  lines.push(`Committed baseline size: ${trendSpark(counts)}`);
  lines.push("");
  if (report.trend.length === 0) {
    lines.push("No git history for `.architecture/arch-lint-baseline.json`.");
  } else {
    lines.push("| When | Entries | Commit |");
    lines.push("| --- | ---: | --- |");
    for (const point of report.trend) {
      lines.push(
        `| ${point.isoDate} | ${point.entryCount} | \`${point.hash.slice(0, 8)}\` ${point.subject.replace(/\|/g, "\\|")} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Suppression ledger");
  lines.push("");
  if (report.suppressions.length === 0) {
    lines.push(
      report.baselinePresent
        ? "Baseline is empty — every finding is enforced."
        : "No baseline file. Every finding is enforced.",
    );
  } else {
    lines.push("| Rule | File | Specifier | Reason | Expires |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const e of report.suppressions) {
      lines.push(
        `| \`${e.rule}\` | \`${e.file}\` | ${e.specifier ? `\`${e.specifier}\`` : ""} | ${e.reason ?? ""} | ${e.expires ?? ""} |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
