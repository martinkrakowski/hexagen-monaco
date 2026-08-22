"use client";

import { useId } from "react";
import {
  CircleCheck,
  FileText,
  OctagonAlert,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  Accordion,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@hexagen/ui";
import { CountPills } from "@/primitives/CountPills";
import type { CountPillItem } from "@/primitives/CountPills";
import { RatchetSparkline } from "@/primitives/RatchetSparkline";
import type { ScanReportModel, ScanReportOutcomeKind } from "./report-summary";
import type { FindingsSourceCounts } from "../FindingsReview/baseline-draft";

/**
 * S6 — the report screen (F-20, BF-7.2). PRESENTATIONAL ONLY.
 *
 * No state, no fetch, no navigation, no verdict of its own: every title,
 * sentence, count and trend point arrives finished from
 * `report-summary.ts`, and the two actions are raised as intents. Same
 * boundary/view split as `LayoutRatifyView` (S3) and `FindingsReviewView`
 * (S5), and no container component, for the reason those two record: the
 * chrome rule puts Back and the primary button in
 * `ProjectsShellWithFreeTier`'s `footer` slot and never in the content column,
 * so the screen is one hook feeding two siblings in two different slots.
 *
 * ## What this screen must not be able to say
 *
 * "0 findings" for a scan that never ran. The pure module refuses to produce
 * that sentence and this file never assembles one: the heading is
 * `outcome.title` verbatim, and the count pills are rendered ONLY when
 * `counts` is non-null — which `summarizeFindingsSource` returns exactly when
 * the findings were actually read. An unread scan therefore has no pills at
 * all rather than four zeroes, because four zeroes IS the false green.
 *
 * The severity icon is decorative in the strict sense (`aria-hidden`): the
 * heading already states the outcome in words, so severity here is never
 * carried by colour or by a glyph alone.
 *
 * ## Composed, not rebuilt
 *
 * `RatchetSparkline` (F-31, `components/`) is the trend — and it is a NEUTRAL
 * component, so it is handed points and sentences rather than a scan. That is
 * the whole reason `buildRatchetTrend` exists on this side of the boundary.
 * `CountPills` (BF-2.3) is the bucket tally, `Card` and `Accordion` come from
 * `@hexagen/ui`. Nothing pill-shaped, card-shaped or disclosure-shaped is
 * written here.
 */

export interface ReportViewProps {
  model: ScanReportModel;
}

/**
 * One glyph per outcome, with distinct silhouettes so the severity survives
 * greyscale. Decorative only — see the docblock above.
 */
const OUTCOME_ICONS: Record<ScanReportOutcomeKind, LucideIcon> = {
  "could-not-run": OctagonAlert,
  unreadable: SearchX,
  inconsistent: TriangleAlert,
  clean: CircleCheck,
  violations: TriangleAlert,
};

/**
 * Bucket pills.
 *
 * `fresh` is the only tone that moves — it is what fails the gate today, so
 * zero of it is genuinely good news. `expired` is `danger` whenever it is
 * non-zero, because an expired baseline entry fails the gate whether or not
 * the finding it suppressed still reproduces, which is the one behaviour on
 * these screens nobody guesses correctly. Same mapping as S5, deliberately: a
 * count that changed colour between the review screen and the report screen
 * would read as a change in the finding.
 */
function bucketPills(counts: FindingsSourceCounts): CountPillItem[] {
  return [
    {
      id: "fresh",
      label: "failing the gate",
      count: counts.fresh,
      tone: counts.fresh === 0 ? "positive" : "warning",
    },
    { id: "baselined", label: "accepted as debt", count: counts.baselined },
    { id: "stale", label: "stale entries", count: counts.stale },
    {
      id: "expired",
      label: "expired entries",
      count: counts.expired,
      tone: counts.expired === 0 ? "neutral" : "danger",
    },
  ];
}

export function ReportView({ model }: ReportViewProps) {
  const headingId = useId();
  const { outcome, counts, trend } = model;
  const OutcomeIcon = OUTCOME_ICONS[outcome.kind];

  return (
    <section aria-labelledby={headingId} className="animate-fade-in-up">
      <div className="flex items-start gap-3">
        {/*
          aria-hidden: the heading names the outcome in words, so announcing
          the glyph would say the same thing twice and say it worse.
        */}
        <OutcomeIcon
          aria-hidden="true"
          className="mt-1 h-6 w-6 shrink-0 text-muted-foreground"
        />
        <div className="flex flex-col gap-2">
          <h2 id={headingId} className="text-xl font-semibold text-foreground">
            {outcome.title}
          </h2>
          <p className="text-sm text-muted-foreground">{outcome.description}</p>
          <p className="text-sm text-muted-foreground">
            {model.projectName
              ? `${model.projectName} — ${model.filesScannedLabel}`
              : model.filesScannedLabel}
          </p>
          {model.gateBlockedReason === null ? null : (
            <p className="text-sm text-destructive">
              {model.gateBlockedReason}
            </p>
          )}
        </div>
      </div>

      {/*
        Pills only when the findings were actually read. `counts === null` is
        "we could not look" -- rendering four zeroes there would print the
        clean bill of health this whole arc exists to prevent, and the heading
        above has already said what happened instead.
      */}
      {counts === null ? null : (
        <div className="mt-6">
          <CountPills pills={bucketPills(counts)} label="Finding counts" />
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle as="h3">How the ratchet has moved</CardTitle>
        </CardHeader>
        <CardContent>
          <RatchetSparkline
            points={trend.points}
            label={trend.label}
            valueHeader="Failing the gate"
            pointHeader="Scan"
            summary={trend.summary ?? undefined}
            insufficientLabel={trend.insufficientLabel ?? undefined}
            emptyLabel={trend.emptyLabel}
          />
        </CardContent>
      </Card>

      {model.reportMarkdown === null ? null : (
        <div className="mt-6">
          {/*
            Collapsed by default and rendered VERBATIM. This is the CLI's own
            report: summarising it here would put a second, paraphrased account
            of the same scan on the same screen as the first, and the two would
            drift the moment the linter changes its wording. `Accordion.Trigger`
            renders only the button, so the heading element is supplied here --
            the section heading is an <h2>, which makes this an <h3>.
          */}
          <Accordion.Root type="multiple">
            <Accordion.Item value="raw-report">
              <h3>
                <Accordion.Trigger>
                  <span className="flex items-center gap-2">
                    <FileText aria-hidden="true" className="h-4 w-4" />
                    The scan&apos;s own report
                  </span>
                </Accordion.Trigger>
              </h3>
              <Accordion.Content>
                {/*
                  <pre> because the payload is markdown text, not markup: this
                  screen does not render it as HTML. Rendering untrusted
                  repository-derived markdown would be a new injection surface
                  for a value nobody on this screen needs styled.
                */}
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-xs text-foreground">
                  {model.reportMarkdown}
                </pre>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion.Root>
        </div>
      )}
    </section>
  );
}

export interface ReportFooterActionsProps {
  canInstallGate: boolean;
  /** Why the installer is unavailable, or `null`. */
  blockedReason: string | null;
  onBack: () => void;
  onInstallGate: () => void;
}

/**
 * The two footer buttons, for the page shell's `footer` slot.
 *
 * `report` is a TERMINAL-WITH-ACTIONS state. There is no navigation in this
 * file and there must not be one added: per the standing
 * no-auto-navigate-past-telemetry rule, the user leaves this screen by
 * pressing "Install the gate", never because a success arm routed them on.
 *
 * The disabled button is DESCRIBED by the reason rather than being silently
 * inert — a keyboard user is told why installing is unavailable before
 * pressing it, not after. Same shape as `FindingsReviewFooterActions`.
 */
export function ReportFooterActions({
  canInstallGate,
  blockedReason,
  onBack,
  onInstallGate,
}: ReportFooterActionsProps) {
  const noteId = useId();

  return (
    <>
      <Button variant="outline" onClick={onBack}>
        Back
      </Button>
      <div className="flex items-center gap-3">
        <span id={noteId} className="sr-only">
          {canInstallGate
            ? "Adds the conformance workflow and your ratified architecture files to the repository."
            : (blockedReason ??
              "This scan did not produce a usable result, so the gate cannot be installed from it.")}
        </span>
        <Button
          onClick={onInstallGate}
          disabled={!canInstallGate}
          aria-describedby={noteId}
        >
          Install the gate
        </Button>
      </div>
    </>
  );
}
