"use client";

import { useId } from "react";
import { FileUp } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@hexagen/ui";
import { CountPills } from "@/primitives/CountPills";
import type { CountPillItem } from "@/primitives/CountPills";
import { EmptyState } from "@/primitives/EmptyState";
import { cn } from "@/lib/utils";
import type { ProjectHandoffResponse } from "@/lib/project-scan/artifact-parse";

/**
 * S1b — Tier A artifact upload (F-15).
 *
 * PRESENTATIONAL ONLY, like its sibling `TierPickerView`: no fetch, no router,
 * no state machine. `BrownfieldImportPage` owns the request, maps every HTTP
 * status onto finished copy, and hands the outcome down as props. That is why
 * this file has no `error`-shaped branching of its own — it renders the alert
 * it is given.
 *
 * ## Why `ScanResultPanel` is NOT composed here
 *
 * `components/conformance/ScanResultPanel` takes a `ScanVerdict`
 * (`pass | violations | could-not-run`). Tier A's verdict union is
 * `ingested | incomplete`, and `app/lib/project-scan/artifact-parse.ts` says in
 * terms why: this route never executes the linter, so claiming a pass/fail it
 * did not compute would be a FABRICATED VERDICT. There is no honest mapping —
 * `incomplete` is emphatically not "could not run scan", which is a statement
 * about an execution that never happened here. Composing the panel would have
 * required inventing the one value the contract refuses to invent, so the
 * Tier-A result is rendered here against its own vocabulary. The report/layout
 * `<pre>` treatment is deliberately identical to the panel's, so if a
 * `HandoffResultPanel` is ever promoted to `components/conformance/` the two
 * already agree visually.
 *
 * ## Why the report is a `<pre>`, not rendered markup
 *
 * The Markdown report is an attacker-supplied upload. The route already refuses
 * to return `hexagen-report.html` for exactly this reason (stored XSS for zero
 * added signal). Rendering the Markdown as HTML here would re-open the hole the
 * route closed, so it is shown as preformatted text — which is also what the
 * Tier-B panel does.
 */

/** Accepted extensions, matching the route's zip part and its loose-file part. */
const FILE_ACCEPT = ".zip,.md,.json,.yaml,.yml";

/** Copy for an alert the boundary component has already finished writing. */
export interface ArtifactUploadAlert {
  /** One short sentence naming what went wrong. */
  title: string;
  /** What the server (or the browser) actually said. */
  detail: string;
  /** What to do next. Omitted when the detail is already the instruction. */
  hint?: string;
}

export interface ArtifactUploadViewProps {
  /** Name carried in from the shared project-name step. */
  projectName: string;
  /** Files staged in the input, in selection order. */
  selectedFiles: readonly File[];
  onFilesSelected: (files: File[]) => void;
  /** True while the upload/parse request is in flight. */
  busy: boolean;
  /**
   * Text for the polite live region. Progress is ANNOUNCED, not merely drawn:
   * a screen-reader user otherwise gets no signal at all between pressing the
   * button and the result appearing.
   */
  statusMessage: string;
  alert: ArtifactUploadAlert | null;
  result: ProjectHandoffResponse | null;
}

const VERDICT_COPY = {
  ingested: {
    title: "Artifacts ingested",
    badge: "Ingested",
    border: "border-success/40",
    badgeClass: "text-success border-success/40",
  },
  incomplete: {
    title: "Handoff was incomplete",
    badge: "Incomplete",
    border: "border-warning/40",
    badgeClass: "text-warning border-warning/40",
  },
} as const;

function formatFileList(files: readonly File[]): string {
  return files.map((file) => file.name).join(", ");
}

function resultPills(result: ProjectHandoffResponse): CountPillItem[] {
  const pills: CountPillItem[] = [
    {
      id: "present",
      label: "received",
      count: result.artifacts.present.length,
      tone: "positive",
    },
  ];
  if (result.artifacts.missing.length > 0) {
    pills.push({
      id: "missing",
      label: "not in the upload",
      count: result.artifacts.missing.length,
      tone: "warning",
    });
  }
  if (result.artifacts.suppressionCount !== null) {
    pills.push({
      id: "suppressions",
      label: "suppressions",
      count: result.artifacts.suppressionCount,
      tone: "neutral",
    });
  }
  if (result.artifacts.baselineEntryCount !== null) {
    pills.push({
      id: "baseline",
      label: "baselined findings",
      count: result.artifacts.baselineEntryCount,
      tone: "neutral",
    });
  }
  return pills;
}

/** One labelled preformatted block — report, layout, manifest. */
function ArtifactExcerpt({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground mb-2">{title}</p>
      <pre className="font-mono text-xs text-foreground bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
        {body}
      </pre>
    </div>
  );
}

export function ArtifactUploadView({
  projectName,
  selectedFiles,
  onFilesSelected,
  busy,
  statusMessage,
  alert,
  result,
}: ArtifactUploadViewProps) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const selectionId = `${inputId}-selection`;
  const verdict = result === null ? null : VERDICT_COPY[result.verdict];

  return (
    <div className="space-y-8">
      <div className="text-center animate-fade-in-up delay-100">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          Upload your scan artifacts
        </h1>
        <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
          Run{" "}
          <code className="font-mono text-foreground">
            npx hexagen scan --handoff
          </code>{" "}
          in your repository, then upload the handoff zip it writes. Your source
          stays on your machine.
        </p>
        <p className="text-sm text-muted-foreground mt-3">
          Project:{" "}
          <span className="font-medium text-foreground">{projectName}</span>
        </p>
      </div>

      <div className="space-y-4 animate-fade-in-up delay-200">
        {/*
          A plain labelled <input type="file">, not a click-only drop zone.
          It is in the tab order for free, activates on Enter/Space for free,
          and announces its own name and description for free — none of which a
          div-with-onClick gets without re-implementing them badly.
        */}
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-foreground"
        >
          Handoff zip, or the individual artifact files
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          aria-describedby={
            selectedFiles.length > 0 ? `${helpId} ${selectionId}` : helpId
          }
          disabled={busy}
          onChange={(event) => {
            onFilesSelected(Array.from(event.target.files ?? []));
          }}
          className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-accent-foreground hover:file:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p id={helpId} className="text-sm text-muted-foreground">
          Select the handoff zip on its own, or select the artifact files
          directly: manifest, layout, baseline, report and ledger. Nothing else
          in the upload is read.
        </p>

        {selectedFiles.length > 0 ? (
          <p id={selectionId} className="text-sm text-foreground">
            Selected: {formatFileList(selectedFiles)}
          </p>
        ) : null}

        {/*
          Progress is announced, not only drawn. `role="status"` is an implicit
          aria-live="polite" region; it is rendered (not sr-only) because a
          sighted user benefits from the same sentence, and it is ALWAYS in the
          tree so assistive tech has a region to observe before the first
          message arrives — a live region mounted at the same moment as its
          first message is frequently not announced at all.
        */}
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "text-sm text-muted-foreground",
            statusMessage === "" && "sr-only",
          )}
        >
          {statusMessage}
        </p>

        {alert !== null ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive space-y-1"
          >
            <p className="font-medium">{alert.title}</p>
            <p className="whitespace-pre-wrap">{alert.detail}</p>
            {alert.hint ? (
              <p className="text-destructive/90">{alert.hint}</p>
            ) : null}
          </div>
        ) : null}

        {result === null && alert === null && selectedFiles.length === 0 ? (
          <EmptyState
            icon={FileUp}
            title="Nothing uploaded yet"
            description="The handoff zip is a handful of small text files. If you have not produced one, run `npx hexagen scan --handoff` in your repository first."
          />
        ) : null}

        {result !== null && verdict !== null ? (
          <Card className={verdict.border}>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle>{verdict.title}</CardTitle>
                <Badge variant="outline" className={verdict.badgeClass}>
                  {verdict.badge}
                </Badge>
              </div>
              {/*
                Says plainly that nothing was executed. Tier B's panel prints an
                exit code here; printing "exited 0" for a run that never
                happened is the fabricated-verdict failure this whole screen is
                built to avoid.
              */}
              <p className="text-sm text-muted-foreground">
                Parsed in place — nothing was executed and no source code was
                uploaded.
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-4">
              <CountPills
                label="Handoff artifact counts"
                pills={resultPills(result)}
              />

              {result.errorMessage !== null ? (
                <p
                  role="alert"
                  className="text-sm text-warning whitespace-pre-wrap"
                >
                  {result.errorMessage}
                </p>
              ) : null}

              {result.artifacts.missing.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Not in the upload: {result.artifacts.missing.join(", ")}.
                </p>
              ) : null}

              {result.warnings.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">
                    Warnings
                  </p>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.reportMarkdown !== null ? (
                <ArtifactExcerpt
                  title="Conformance report"
                  body={result.reportMarkdown}
                />
              ) : null}

              {result.layoutExcerpt !== null ? (
                <ArtifactExcerpt
                  title="Layout excerpt"
                  body={result.layoutExcerpt}
                />
              ) : null}

              {result.artifacts.manifestExcerpt !== null ? (
                <ArtifactExcerpt
                  title="Manifest excerpt"
                  body={result.artifacts.manifestExcerpt}
                />
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
