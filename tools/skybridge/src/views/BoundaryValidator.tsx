import "@/index.css";

import {
  CircleAlert,
  FileWarning,
  Layers,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useLayout } from "skybridge/web";
import { useToolInfo } from "../helpers.js";

// BoundaryValidator renders the LinterReport produced by the hexagen-monaco
// governance engine (via the `validate_domain_boundaries` tool, which delegates
// to @hexagen/mcp-server's AuditBoundariesToolUseCase). This component owns no
// analysis logic — it is purely a presentation surface, and is built as a
// self-contained card so it can later be hosted inside the ProjectWorkspace
// layout shell as one panel among several.

interface BoundaryViolation {
  ruleId: string;
  severity: "error" | "warning";
  file: string;
  message: string;
  snippet?: string;
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function ViolationRow({ violation }: { violation: BoundaryViolation }) {
  const isError = violation.severity === "error";
  const Icon = isError ? CircleAlert : TriangleAlert;
  const accent = isError
    ? "border-rose-500/40 bg-rose-500/5"
    : "border-amber-500/40 bg-amber-500/5";
  const iconTone = isError ? "text-rose-500" : "text-amber-500";

  return (
    <li className={`flex gap-3 rounded-lg border p-3 ${accent}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{violation.message}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {violation.ruleId}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileWarning className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate font-mono">{violation.file}</span>
        </div>
        {violation.snippet && (
          <pre className="mt-1 overflow-x-auto rounded bg-muted/60 p-2 font-mono text-xs text-foreground">
            {violation.snippet}
          </pre>
        )}
      </div>
    </li>
  );
}

export default function BoundaryValidator() {
  const { theme } = useLayout();
  const { output, isPending } = useToolInfo<"validate_domain_boundaries">();

  const dark = theme === "dark" ? "dark" : "";

  if (isPending || !output) {
    return (
      <div
        className={`${dark} mx-auto w-full max-w-4xl rounded-xl border border-border bg-background p-6 text-foreground`}
      >
        <div className="flex items-center gap-3 text-muted-foreground">
          <Layers className="h-5 w-5 animate-pulse" aria-hidden />
          <span>Auditing architecture boundaries…</span>
        </div>
      </div>
    );
  }

  // Error branch: the governance engine threw (e.g. workspace root not found).
  if (!output.ok) {
    return (
      <div
        className={`${dark} mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-background text-foreground`}
      >
        <div className="flex flex-col gap-1 border-b border-border bg-rose-500/5 p-5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-rose-500" aria-hidden />
            <h2 className="text-base font-semibold">Boundary audit failed</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Engine could not complete the audit for{" "}
            <span className="font-mono text-foreground">
              {output.workspaceRoot}
            </span>
            .
          </p>
        </div>
        <pre className="m-5 overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-xs text-foreground">
          {output.error}
        </pre>
      </div>
    );
  }

  const { summary, violations, scannedFilesCount, isCompliant, dryRun } =
    output;

  // errors first, then warnings, so the most severe leaks surface at the top.
  const sorted = [...violations].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
  );

  return (
    <div
      className={`${dark} mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-background text-foreground`}
    >
      {/* Header / status banner */}
      <div
        className={`flex flex-col gap-1 border-b border-border p-5 ${
          isCompliant
            ? "bg-emerald-500/5"
            : summary.errors > 0
              ? "bg-rose-500/5"
              : "bg-amber-500/5"
        }`}
      >
        <div className="flex items-center gap-2">
          {isCompliant ? (
            <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden />
          ) : (
            <CircleAlert className="h-5 w-5 text-rose-500" aria-hidden />
          )}
          <h2 className="text-base font-semibold">
            {isCompliant
              ? "Architecture is compliant"
              : "Boundary violations detected"}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Audited by the hexagen-monaco governance engine
          {dryRun ? " (dry run)" : ""}.
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-4">
        <StatTile label="Files scanned" value={scannedFilesCount} />
        <StatTile label="Violations" value={summary.violations} />
        <StatTile label="Errors" value={summary.errors} />
        <StatTile label="Warnings" value={summary.warnings} />
      </div>

      {/* Violations, or the compliant-state panel */}
      <div className="px-5 pb-5">
        {isCompliant ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-500" aria-hidden />
            <p className="font-medium">No boundary violations</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Every scanned file respects the hexagonal architecture boundaries
              defined in the governance invariants.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((v, i) => (
              <ViolationRow key={`${v.ruleId}-${v.file}-${i}`} violation={v} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
