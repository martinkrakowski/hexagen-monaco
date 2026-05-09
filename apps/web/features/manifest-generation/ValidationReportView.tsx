import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import type {
  ManifestViewData,
  ValidationItem,
} from "@hexagen/manifest-generation";

interface ValidationReportViewProps {
  viewData: ManifestViewData;
  onRequestFix?: (violation: ValidationItem) => void;
}

export function ValidationReportView({
  viewData,
  onRequestFix,
}: ValidationReportViewProps) {
  const p = viewData.validationItems.filter((v) => v.status === "pass").length;
  const w = viewData.validationItems.filter((v) => v.status === "warn").length;
  const f = viewData.validationItems.filter((v) => v.status === "fail").length;
  const score = viewData.overallScore;

  const scoreColor =
    score >= 80
      ? "text-success"
      : score >= 50
        ? "text-warning"
        : "text-destructive";
  const strokeColor =
    score >= 80
      ? "var(--success)"
      : score >= 50
        ? "var(--warning)"
        : "var(--destructive)";

  const offset = 283 - (283 * score) / 100;

  return (
    <div className="max-w-2xl mx-auto p-8 animate-fade-in-up">
      <div className="flex items-center gap-5 mb-7">
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="5"
            />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke={`hsl(${strokeColor})`}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="283"
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 1s ease-in-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${scoreColor}`}>{score}</span>
            <span className="text-xs text-muted-foreground">SCORE</span>
          </div>
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Validation Report
          </h2>
          <p className="text-sm mt-1 text-muted-foreground">
            {p} passed &middot; {w} warning{w !== 1 ? "s" : ""} &middot; {f}{" "}
            failed &middot; {viewData.validationItems.length} checks
          </p>
          <div className="flex gap-2 mt-3">
            <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success font-mono">
              PASS {p}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-warning/10 text-warning font-mono">
              WARN {w}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive font-mono">
              FAIL {f}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {viewData.validationItems.map((v, i) => {
          const isPass = v.status === "pass";
          const isWarn = v.status === "warn";

          return (
            <div
              key={i}
              className={`p-4 rounded-xl bg-card border-l-4 animate-fade-in-up ${isPass ? "border-success" : isWarn ? "border-warning" : "border-destructive"}`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-start gap-3">
                {isPass ? (
                  <CheckCircle2 className="w-4 h-4 text-success mt-0.5" />
                ) : isWarn ? (
                  <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-destructive mt-0.5" />
                )}
                <div>
                  <div className="text-sm font-semibold">{v.title}</div>
                  <div
                    className="text-xs mt-1 text-muted-foreground leading-relaxed [&_code]:font-mono [&_code]:text-primary"
                    dangerouslySetInnerHTML={{
                      __html: v.description.replace(
                        /`([^`]+)`/g,
                        "<code>$1</code>",
                      ),
                    }}
                  />
                </div>
                {!isPass && onRequestFix && (
                  <button
                    onClick={() => onRequestFix(v)}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent/90 text-accent-foreground text-xs font-semibold transition-colors"
                  >
                    ✨ Fix
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {f > 0 && (
        <div
          className="mt-8 p-5 rounded-xl bg-destructive/5 border border-destructive/20 animate-fade-in-up"
          style={{ animationDelay: "500ms" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-destructive" />
            <span className="text-sm font-bold text-destructive">
              Cannot Approve
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-destructive">{f} critical issues</strong>{" "}
            block approval. Please resolve all validation failures before
            proceeding.
          </p>
        </div>
      )}
    </div>
  );
}
