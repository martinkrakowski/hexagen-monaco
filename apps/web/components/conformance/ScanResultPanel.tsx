import { Badge, Card, CardContent, CardHeader, CardTitle } from "@hexagen/ui";
import type { ScanVerdict } from "@/lib/project-scan/types";

interface ScanResultPanelProps {
  readonly verdict: ScanVerdict;
  readonly exitCode: number | null;
  readonly layoutExcerpt: string | null;
  readonly filesScanned: number | null;
  readonly reportMarkdown: string | null;
  readonly errorMessage: string | null;
}

const VERDICT_COPY: Record<
  ScanVerdict,
  { title: string; badge: string; badgeVariant: "outline" | "destructive" }
> = {
  pass: { title: "Scan passed", badge: "Pass", badgeVariant: "outline" },
  violations: {
    title: "Scan found violations",
    badge: "Violations",
    badgeVariant: "outline",
  },
  "could-not-run": {
    title: "Could not run scan",
    badge: "Could not run",
    badgeVariant: "destructive",
  },
};

const VERDICT_BORDER: Record<ScanVerdict, string> = {
  pass: "border-success/40",
  violations: "border-warning/40",
  "could-not-run": "border-destructive/40",
};

const VERDICT_BADGE_COLOR: Record<ScanVerdict, string> = {
  pass: "text-success border-success/40",
  violations: "text-warning border-warning/40",
  "could-not-run": "",
};

export function ScanResultPanel({
  verdict,
  exitCode,
  layoutExcerpt,
  filesScanned,
  reportMarkdown,
  errorMessage,
}: ScanResultPanelProps) {
  const copy = VERDICT_COPY[verdict];

  return (
    <Card className={VERDICT_BORDER[verdict]}>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{copy.title}</CardTitle>
          <Badge
            variant={copy.badgeVariant}
            className={VERDICT_BADGE_COLOR[verdict]}
          >
            {copy.badge}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {exitCode !== null
            ? `hexagen scan exited ${exitCode}`
            : "hexagen scan did not start"}
          {filesScanned !== null ? ` · ${filesScanned} files scanned` : ""}
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {errorMessage && (
          <p
            role="alert"
            className="text-sm text-destructive whitespace-pre-wrap"
          >
            {errorMessage}
          </p>
        )}
        {layoutExcerpt && (
          <div>
            <p className="text-sm font-medium text-foreground mb-2">
              Layout excerpt
            </p>
            <pre className="font-mono text-xs text-foreground bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
              {layoutExcerpt}
            </pre>
          </div>
        )}
        {reportMarkdown && (
          <div>
            <p className="text-sm font-medium text-foreground mb-2">
              Scan report
            </p>
            <pre className="font-mono text-xs text-foreground bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
              {reportMarkdown}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
