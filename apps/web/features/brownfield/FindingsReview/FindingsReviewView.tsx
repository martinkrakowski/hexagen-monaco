"use client";

import { useId, useMemo } from "react";
import type { FormEvent } from "react";
import { CircleCheck, SearchX } from "lucide-react";
import { Accordion, Badge, Button, Checkbox, Input } from "@hexagen/ui";
import { CountPills } from "@/primitives/CountPills";
import type { CountPillItem } from "@/primitives/CountPills";
import { EmptyState } from "@/primitives/EmptyState";
import { EntityDataGrid } from "@/primitives/EntityDataGrid";
import type { EntityDataGridColumn } from "@/primitives/EntityDataGrid";
import { cn } from "@/lib/utils";
import type {
  FindingsAdvisory,
  FindingsReviewRow,
  FindingsReviewRuleGroup,
  FindingsReviewValidation,
  FindingsSourceCounts,
} from "./baseline-draft";

/**
 * S5 — findings review and baseline seeding (F-19, BF-4.4). PRESENTATIONAL ONLY.
 *
 * It holds no state, performs no navigation and computes no verdict: every
 * row, count, message and consequence sentence is handed in, and every edit is
 * raised as an intent. That split is what lets the screen be exercised without
 * a router, a fetch stub or the free-tier context — the same boundary/view
 * split `BrownfieldImportPage` established for S1 and `LayoutRatifyView` for S3.
 *
 * ## What this screen has to communicate
 *
 * Baselining is accepting debt. A baselined finding stops failing CI, and it
 * keeps not failing CI on every future run until someone deletes the entry.
 * Three things carry that, and none of them is colour alone:
 *
 *  - the consequence is spelled out as a SENTENCE, live, in the sticky summary
 *    ("27 findings will be recorded as accepted debt and will stop failing the
 *    gate. 7 will keep failing it until fixed."), not left to be inferred from
 *    two numbers;
 *  - the justification field sits IN the row, next to the decision, not behind
 *    a disclosure — it is required, and a required field the user has to go
 *    looking for is a field that gets filled with "n/a";
 *  - accepting is a deliberate tick; enforcing is the default. Un-accepting is
 *    always one click, in both the single and the bulk direction.
 *
 * ## Bulk selection
 *
 * There is no repo-wide "baseline everything" control on this screen, and the
 * pure module cannot express one (`baseline-draft.ts` -> `baselineRuleGroup`
 * carries the full argument). The bulk affordance is per RULE GROUP, it
 * requires a typed reason, and it lives INSIDE the group's accordion panel —
 * so a rule cannot be mass-accepted without first being opened and looked at.
 * The clearing direction (`Leave all enforced`, and `Clear every baseline` in
 * the summary bar) needs no justification and is always one click.
 *
 * ## The three-way source distinction is visible, not swallowed
 *
 * `unavailable` non-null means the findings were NOT read — either the CLI
 * tried and failed, or it never reported a list at all. That renders as an
 * `EmptyState` carrying the reason, NOT as "0 findings", and `validation`
 * blocks Continue. A scan that never ran must never be ratifiable as a clean
 * tree; that is the whole reason `ScanFindings` is a discriminated union.
 * `EmptyState` has no `error` prop by design, so the finished copy arrives as
 * `title`/`description` from the pure module.
 *
 * ## Composed, not rebuilt
 *
 * `EntityDataGrid` (BF-2.1) is every table here — the per-rule decision grid
 * and the advisory grid — including the below-`md` stacked-card layout.
 * `Accordion` (`@hexagen/ui`) is the per-rule grouping, with each trigger
 * wrapped in a real `<h3>` because the component deliberately does not supply
 * heading semantics. `CountPills` (BF-2.3) is the bucket tally, `EmptyState`
 * (BF-2.3) is every "nothing here" surface, and `Checkbox`, `Input`, `Badge`
 * and `Button` come from `@hexagen/ui`. Nothing tabular, pill-shaped or
 * disclosure-shaped is written here.
 */

export interface FindingsReviewViewProps {
  /** Fresh findings grouped by rule, largest group first. */
  groups: readonly FindingsReviewRuleGroup[];
  /** Stale and expired baseline entries. Read-only on this screen. */
  advisories: readonly FindingsAdvisory[];
  /** Bucket totals, or `null` when the findings were not read at all. */
  counts: FindingsSourceCounts | null;
  /**
   * Finished copy for the arms where there is no list to review, or `null`
   * when there is one. Non-null is "we could not look", never "there is
   * nothing".
   */
  unavailable: { readonly title: string; readonly description: string } | null;
  validation: FindingsReviewValidation;
  /** One sentence naming what continuing will actually do. */
  consequence: string;
  onToggleBaselined: (key: string, baselined: boolean) => void;
  onReasonChange: (key: string, reason: string) => void;
  onExpiresChange: (key: string, expires: string) => void;
  onBaselineRule: (rule: string, reason: string) => void;
  onClearRule: (rule: string) => void;
  onClearAll: () => void;
  /** Carried project name, shown for orientation. */
  projectName?: string;
}

/**
 * Bucket pills.
 *
 * `fresh` is the only tone that moves: it is the count that fails the gate
 * today, so zero of them is genuinely good news and any other number is the
 * work. `expired` is `danger` unconditionally — an expired entry fails the
 * gate whether or not the finding is gone, which is the one behaviour on this
 * screen nobody guesses correctly.
 */
/**
 * Accessible-name suffix that disambiguates two findings sharing rule+file.
 *
 * A finding's identity is rule + file + SPECIFIER (it mirrors the linter's
 * violationKey). Naming a control by rule and file alone gives two distinct
 * rows the same accessible name -- so a screen-reader user cannot tell which
 * import they are accepting, and getByLabelText becomes ambiguous in tests.
 */
function rowSuffix(row: FindingsReviewRow): string {
  return row.specifier ? ` (${row.specifier})` : "";
}

function bucketPills(counts: FindingsSourceCounts): CountPillItem[] {
  return [
    {
      id: "fresh",
      label: "failing now",
      count: counts.fresh,
      tone: counts.fresh === 0 ? "positive" : "warning",
    },
    { id: "baselined", label: "already accepted", count: counts.baselined },
    { id: "stale", label: "stale entries", count: counts.stale },
    {
      id: "expired",
      label: "expired entries",
      count: counts.expired,
      tone: counts.expired === 0 ? "neutral" : "danger",
    },
  ];
}

function summaryPills(validation: FindingsReviewValidation): CountPillItem[] {
  const pills: CountPillItem[] = [
    {
      id: "accepting",
      label: "accepted as debt",
      count: validation.baselinedCount,
    },
    {
      id: "enforced",
      label: "still failing",
      count: validation.enforcedCount,
      tone: validation.enforcedCount === 0 ? "positive" : "warning",
    },
  ];
  if (validation.expiringCount > 0) {
    pills.push({
      id: "expiring",
      label: "with an end date",
      count: validation.expiringCount,
    });
  }
  if (validation.errorCount > 0) {
    pills.push({
      id: "errors",
      label: "need a fix",
      count: validation.errorCount,
      tone: "danger",
    });
  }
  return pills;
}

/**
 * Advisory columns.
 *
 * Module-scoped rather than built in the component body: they close over
 * nothing, so rebuilding them per render would be work with no purpose. The
 * decision columns above cannot do the same — they close over the handlers and
 * the validation the host passes in.
 */
const advisoryColumns: EntityDataGridColumn<FindingsAdvisory>[] = [
  {
    id: "kind",
    header: "State",
    cell: (advisory) => (
      <Badge
        variant={advisory.kind === "expired" ? "destructive" : "secondary"}
      >
        {advisory.kind === "expired" ? "Expired" : "Stale"}
      </Badge>
    ),
  },
  {
    id: "file",
    header: "File",
    cell: (advisory) => (
      <div className="flex flex-col gap-1">
        <span className="font-mono text-sm break-all">{advisory.file}</span>
        <span className="font-mono text-xs text-muted-foreground break-all">
          {advisory.rule}
        </span>
      </div>
    ),
  },
  {
    id: "consequence",
    header: "What it means",
    cell: (advisory) => (
      <span className="text-sm text-muted-foreground">
        {advisory.consequence}
      </span>
    ),
  },
  {
    id: "recorded",
    header: "Recorded as",
    cell: (advisory) => (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">
          {advisory.reason === "" ? "No reason recorded" : advisory.reason}
        </span>
        {advisory.expires === "" ? null : (
          <span className="text-xs text-muted-foreground">
            {`Expired ${advisory.expires}`}
          </span>
        )}
      </div>
    ),
  },
];

export function FindingsReviewView({
  groups,
  advisories,
  counts,
  unavailable,
  validation,
  consequence,
  onToggleBaselined,
  onReasonChange,
  onExpiresChange,
  onBaselineRule,
  onClearRule,
  onClearAll,
  projectName,
}: FindingsReviewViewProps) {
  const headingId = useId();
  const instanceId = useId();

  /**
   * `aria-describedby` needs a stable element id per row, and a row key is
   * `rule\0file\0specifier` — legal in an `id` attribute but hostile to
   * anything that later selects on one, and it carries a NUL. Index
   * positionally instead, exactly as `EntityDataGrid` does for its own detail
   * rows and `LayoutRatifyView` does for its messages.
   */
  const rowElementIds = useMemo(() => {
    const ids = new Map<string, { message: string; expires: string }>();
    let index = 0;
    for (const group of groups) {
      for (const row of group.rows) {
        ids.set(row.key, {
          message: `${instanceId}-message-${index}`,
          expires: `${instanceId}-expires-${index}`,
        });
        index += 1;
      }
    }
    return ids;
  }, [groups, instanceId]);

  const totalFresh = useMemo(
    () => groups.reduce((sum, group) => sum + group.rows.length, 0),
    [groups],
  );

  const columns: EntityDataGridColumn<FindingsReviewRow>[] = [
    {
      id: "baseline",
      header: "Accept",
      cell: (row) => (
        <Checkbox
          checked={row.baselined}
          onCheckedChange={(checked) => onToggleBaselined(row.key, checked)}
          aria-label={`Accept ${row.rule} in ${row.file}${rowSuffix(row)} as pre-existing debt`}
        />
      ),
    },
    {
      id: "file",
      header: "File",
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-sm break-all">{row.file}</span>
          {row.specifier === "" ? null : (
            <span className="font-mono text-xs text-muted-foreground break-all">
              {row.specifier}
            </span>
          )}
          {row.lapsedOn === null ? null : (
            // Stated, not implied: this finding was already accepted once and
            // the suppression lapsed, so the user is renewing rather than
            // deciding for the first time.
            <span>
              <Badge variant="outline">{`Was accepted until ${row.lapsedOn}`}</Badge>
            </span>
          )}
        </div>
      ),
    },
    {
      id: "message",
      header: "What the linter says",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.message === "" ? row.rule : row.message}
        </span>
      ),
    },
    {
      id: "reason",
      header: "Why it is accepted",
      cell: (row) => {
        const message = validation.rowMessages[row.key];
        const messageId = rowElementIds.get(row.key)?.message;
        return (
          <div className="flex flex-col gap-1">
            <Input
              value={row.reason}
              onChange={(event) => onReasonChange(row.key, event.target.value)}
              disabled={!row.baselined}
              placeholder="Required — e.g. predates adoption, tracked in ADR-0054"
              aria-label={`Why ${row.rule} in ${row.file}${rowSuffix(row)} is accepted debt`}
              aria-describedby={message ? messageId : undefined}
              aria-invalid={message?.severity === "error" ? true : undefined}
            />
            {message ? (
              <p
                id={messageId}
                className={cn(
                  "text-xs",
                  message.severity === "error"
                    ? "text-destructive"
                    : "text-warning",
                )}
              >
                {message.text}
              </p>
            ) : null}
          </div>
        );
      },
    },
  ];

  /**
   * The expiry field, disclosed rather than inline.
   *
   * It is optional and it is the one field whose behaviour is counter-
   * intuitive, so it gets room for the sentence that explains it instead of a
   * tooltip. `type="date"` because the linter parses `YYYY-MM-DD` and nothing
   * else (`parseExpiresDate` throws on any other spelling), and a native date
   * control is the only input that cannot produce `31/12/2026`.
   */
  const renderExpandedRow = (row: FindingsReviewRow) => {
    const message = validation.rowMessages[row.key];
    const ids = rowElementIds.get(row.key);
    return (
      <div className="flex flex-col gap-2 py-2">
        <label
          className="text-xs font-medium text-foreground"
          htmlFor={ids?.expires}
        >
          Stop accepting it after (optional)
        </label>
        <Input
          id={ids?.expires}
          type="date"
          value={row.expires}
          onChange={(event) => onExpiresChange(row.key, event.target.value)}
          disabled={!row.baselined}
          aria-describedby={message ? ids?.message : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Leave this empty for an open-ended acceptance. If you set a date, the
          entry fails the gate from the day after it — even if the finding has
          been fixed by then. Renew it or delete it before that day.
        </p>
      </div>
    );
  };

  const handleBulkSubmit =
    (rule: string) => (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const field = form.elements.namedItem("bulk-reason");
      const reason = field instanceof HTMLInputElement ? field.value : "";
      // A whitespace-only reason is a no-op in the pure module, so nothing
      // is accepted and nothing is cleared — the field keeps what was typed
      // and the user can see why it did nothing.
      if (reason.trim() === "") return;
      onBaselineRule(rule, reason);
      form.reset();
    };

  return (
    <section aria-labelledby={headingId} className="animate-fade-in-up">
      {/*
        The heading is COUNT-BEARING only when there is a count to bear. With
        `unavailable` set, `totalFresh` is 0 because no rows could be built —
        and "0 findings are failing the gate" is precisely the clean bill of
        health that a scan which never reported must not be able to print. The
        specific reason follows in the EmptyState below.
      */}
      <h2 id={headingId} className="text-xl font-semibold text-foreground">
        {unavailable
          ? "This scan cannot be ratified"
          : totalFresh === 1
            ? "1 finding is failing the gate. Decide whether you are accepting it."
            : `${totalFresh} findings are failing the gate. Decide which ones you are accepting.`}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {unavailable
          ? "A baseline can only be written from findings the scan actually read, and this one has none to show. Nothing here says the codebase is clean."
          : projectName
            ? `Accepting a finding records it in ${projectName}'s baseline as pre-existing debt: it stops failing the gate, on this run and every run after it, until someone deletes the entry. Anything you leave alone keeps failing until it is fixed.`
            : "Accepting a finding records it in the baseline as pre-existing debt: it stops failing the gate, on this run and every run after it, until someone deletes the entry. Anything you leave alone keeps failing until it is fixed."}
      </p>

      {counts === null ? null : (
        <div className="mt-4">
          <CountPills pills={bucketPills(counts)} label="Finding counts" />
        </div>
      )}

      {unavailable ? (
        <div className="mt-6">
          <EmptyState
            icon={SearchX}
            headingLevel={3}
            title={unavailable.title}
            description={unavailable.description}
          />
        </div>
      ) : totalFresh === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={CircleCheck}
            headingLevel={3}
            title="Nothing is failing the gate"
            description="The scan read the findings and none of them are new. There is no debt to accept here, so the baseline stays as it is."
          />
        </div>
      ) : (
        <div className="mt-6">
          {/*
            The largest group starts open, the rest closed. A wall of 34 open
            rows is not a review, and a wall of closed ones is not a screen —
            opening the biggest block of debt means the reader lands on real
            findings without having to be told to click something.
          */}
          <Accordion.Root type="multiple" defaultValue={[groups[0].rule]}>
            {groups.map((group) => (
              <Accordion.Item key={group.rule} value={group.rule}>
                {/*
                  WAI-ARIA puts the accordion header in a heading element at the
                  level the page's outline calls for, and `Accordion.Trigger`
                  deliberately renders only the button. The section heading
                  above is an <h2>, so each rule is an <h3>.
                */}
                <h3>
                  <Accordion.Trigger>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{group.rule}</span>
                      <span className="text-xs text-muted-foreground">
                        {`${group.rows.length} ${group.rows.length === 1 ? "finding" : "findings"}`}
                      </span>
                      {group.baselinedCount > 0 ? (
                        <Badge variant="secondary">
                          {`${group.baselinedCount} accepted`}
                        </Badge>
                      ) : null}
                    </span>
                  </Accordion.Trigger>
                </h3>
                <Accordion.Content>
                  {/*
                    The bulk control lives INSIDE the panel, so a rule cannot be
                    mass-accepted without being opened first. It is also a real
                    <form>: the reason field is uncontrolled, which keeps this
                    component stateless, and `required` plus the pure module's
                    empty-reason no-op means an unjustified bulk accept is not
                    expressible from either side.
                  */}
                  <form
                    className="mb-4 flex flex-col gap-2 rounded-lg border border-border p-3 md:flex-row md:items-end"
                    onSubmit={handleBulkSubmit(group.rule)}
                  >
                    <div className="flex flex-1 flex-col gap-1">
                      <label
                        className="text-xs font-medium text-foreground"
                        htmlFor={`${instanceId}-bulk-${group.rule}`}
                      >
                        {`Accept all ${group.rows.length} under one reason`}
                      </label>
                      <Input
                        id={`${instanceId}-bulk-${group.rule}`}
                        name="bulk-reason"
                        required
                        placeholder="Why is every one of these accepted debt?"
                      />
                      <span className="text-xs text-muted-foreground">
                        Rows that already have their own reason keep it.
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" variant="outline" size="sm">
                        Accept all
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onClearRule(group.rule)}
                        disabled={group.baselinedCount === 0}
                      >
                        Leave all enforced
                      </Button>
                    </div>
                  </form>

                  <EntityDataGrid
                    rows={group.rows}
                    columns={columns}
                    rowKey={(row) => row.key}
                    rowHeaderColumnId="file"
                    caption={`Findings reported by ${group.rule}`}
                    captionAppearance="screen-reader-only"
                    density="compact"
                    renderExpandedRow={renderExpandedRow}
                    expandLabel={(row) =>
                      `Expiry for ${row.rule} in ${row.file}`
                    }
                    rowVariant={(row) =>
                      validation.rowMessages[row.key]?.severity === "error"
                        ? "critical"
                        : row.baselined
                          ? // Accepted debt is HIGHLIGHTED, never dimmed. A
                            // "muted" row reads as de-emphasised, and the rows
                            // the user chose to stop enforcing are the ones
                            // that most need to stay visible on a re-read.
                            "attention"
                          : "default"
                    }
                  />
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </div>
      )}

      {advisories.length > 0 ? (
        <section className="mt-8">
          <h3 className="text-lg font-medium text-foreground">
            Baseline entries that need attention
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            These are not decisions you make here. They are entries already in
            the baseline file that no longer line up with the code — listed
            separately because you cannot accept or reject them, only fix them
            in the repository.
          </p>
          <div className="mt-4">
            <EntityDataGrid
              rows={advisories}
              columns={advisoryColumns}
              rowKey={(advisory) => advisory.key}
              rowHeaderColumnId="file"
              caption="Stale and expired baseline entries, and what each one means"
              captionAppearance="screen-reader-only"
              density="compact"
              rowVariant={(advisory) =>
                advisory.kind === "expired" ? "critical" : "muted"
              }
            />
          </div>
        </section>
      ) : null}

      {unavailable === null && totalFresh > 0 ? (
        <div className="sticky bottom-0 z-10 mt-6 flex flex-col gap-2 border-t border-border bg-background py-3 md:flex-row md:items-center md:justify-between">
          {/*
            The live region is mounted for the whole life of the review UI and
            only its CONTENTS change: a region that appears at the same moment
            as its text is unreliable in every screen reader, because the node
            has to be observed before the mutation for the mutation to be
            announced. (The two arms where it is absent — an unread scan and a
            clean one — have no decisions to announce, and their own copy is a
            static EmptyState.) `polite`, not `alert`: this changes on every
            tick, and an assertive interrupt each time would be hostile.
          */}
          <div role="status" aria-live="polite" className="flex flex-col gap-1">
            <CountPills
              pills={summaryPills(validation)}
              appearance="inline"
              label="Baseline decisions"
            />
            <p className="text-sm text-foreground">{consequence}</p>
            {validation.blockingReason === null ? null : (
              <p className="text-sm text-destructive">
                {validation.blockingReason}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            disabled={validation.baselinedCount === 0}
          >
            Clear every baseline
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export interface FindingsReviewFooterActionsProps {
  validation: FindingsReviewValidation;
  /** The same sentence the summary bar shows. */
  consequence: string;
  onBack: () => void;
  onContinue: () => void;
}

/**
 * The two footer buttons, for the page shell's `footer` slot.
 *
 * Lives here rather than in the page so the "may this be ratified?" question
 * has one answer: `validation.blockingReason`. A page that re-derived it would
 * drift from `validateFindingsReview` on the first rule added.
 *
 * The disabled button is DESCRIBED by the reason rather than being silently
 * inert, and the enabled one is described by the consequence — so a keyboard
 * user is told what Continue will do before pressing it, not after.
 *
 * NOTE for whoever builds `/projects/new/import/ratify`: this belongs in
 * `ProjectsShellWithFreeTier`'s `footer` prop, never inside the content
 * column. Ratifying must go through the flow machine's `RATIFY_FINDINGS`
 * event — there is no navigation in this file, and there must not be one added
 * here.
 */
export function FindingsReviewFooterActions({
  validation,
  consequence,
  onBack,
  onContinue,
}: FindingsReviewFooterActionsProps) {
  const noteId = useId();
  const blocked = validation.blockingReason !== null;

  return (
    <>
      <Button variant="outline" onClick={onBack}>
        Back
      </Button>
      <div className="flex items-center gap-3">
        <span id={noteId} className="sr-only">
          {blocked ? validation.blockingReason : consequence}
        </span>
        <Button
          onClick={onContinue}
          disabled={blocked}
          aria-describedby={noteId}
        >
          Continue
        </Button>
      </div>
    </>
  );
}
