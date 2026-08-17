import type { EngagementReport } from "./types.js";
import { renderReportMarkdown } from "./render-markdown.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderReportHtml(report: EngagementReport): string {
  const md = renderReportMarkdown(report);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hexagen engagement report — ${escapeHtml(report.systemName)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 52rem; line-height: 1.5; padding: 0 1rem; }
    h1, h2, h3 { line-height: 1.25; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
    th, td { border: 1px solid #8884; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
    code { font-size: 0.85em; }
    pre { overflow: auto; background: #1113; padding: 0.75rem; }
    .meta { color: #666; }
    .mermaid { margin: 1.5rem 0; }
  </style>
</head>
<body>
  <p class="meta">Self-contained engagement artifact. Context map rendered by Mermaid in the browser; source is in the Markdown section below.</p>
  <h1>Hexagen engagement report — ${escapeHtml(report.systemName)}</h1>
  <p class="meta">${escapeHtml(report.generatedAt)} · ${escapeHtml(report.workspaceRoot)}</p>
  <h2>Context map</h2>
  <pre class="mermaid">${escapeHtml(report.mermaid)}</pre>
  <h2>Drift vs baseline</h2>
  ${
    report.drift.collected
      ? `<table><thead><tr><th>Fresh</th><th>Suppressed</th><th>Stale</th><th>Expired</th></tr></thead><tbody><tr><td>${report.drift.fresh.length}</td><td>${report.drift.baselined.length}</td><td>${report.drift.stale.length}</td><td>${report.drift.expired.length}</td></tr></tbody></table>`
      : "<p>Live linter output was not collected.</p>"
  }
  <h2>Ratchet trend</h2>
  <table><thead><tr><th>When</th><th>Entries</th><th>Commit</th></tr></thead><tbody>
  ${
    report.trend.length === 0
      ? '<tr><td colspan="3">No git history for the baseline file.</td></tr>'
      : report.trend
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.isoDate)}</td><td>${p.entryCount}</td><td><code>${escapeHtml(p.hash.slice(0, 8))}</code> ${escapeHtml(p.subject)}</td></tr>`,
          )
          .join("")
  }
  </tbody></table>
  <h2>Suppression ledger</h2>
  <table><thead><tr><th>Rule</th><th>File</th><th>Specifier</th><th>Reason</th><th>Expires</th></tr></thead><tbody>
  ${
    report.suppressions.length === 0
      ? '<tr><td colspan="5">No suppressions.</td></tr>'
      : report.suppressions
          .map(
            (e) =>
              `<tr><td><code>${escapeHtml(e.rule)}</code></td><td><code>${escapeHtml(e.file)}</code></td><td>${e.specifier ? `<code>${escapeHtml(e.specifier)}</code>` : ""}</td><td>${escapeHtml(e.reason ?? "")}</td><td>${escapeHtml(e.expires ?? "")}</td></tr>`,
          )
          .join("")
  }
  </tbody></table>
  <h2>Markdown source</h2>
  <pre>${escapeHtml(md)}</pre>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: true, theme: "neutral" });
  </script>
</body>
</html>
`;
}
