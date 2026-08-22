"use client";

import { useId, useMemo } from "react";
import { FolderSearch } from "lucide-react";
import { Badge, Button, Checkbox, Input } from "@hexagen/ui";
import { ChipInput } from "@/ChipInput";
import { CountPills } from "@/primitives/CountPills";
import type { CountPillItem } from "@/primitives/CountPills";
import { EmptyState } from "@/primitives/EmptyState";
import { EntityDataGrid } from "@/primitives/EntityDataGrid";
import type { EntityDataGridColumn } from "@/primitives/EntityDataGrid";
import { cn } from "@/lib/utils";
import {
  LAYOUT_LAYERS,
  hasNoDetectedLayers,
  layoutRowChanges,
  type LayoutLayerName,
  type LayoutRatifyRow,
  type LayoutRatifyValidation,
} from "./layout-draft";

/**
 * S3 — layout ratification (F-17, BF-4.1). PRESENTATIONAL ONLY.
 *
 * It holds no state, performs no navigation and computes no verdict: every row
 * and every message is handed in, and every edit is raised as an intent. That
 * split is what lets the screen be exercised without a router, a fetch stub or
 * the free-tier context — the same boundary/view split `BrownfieldImportPage`
 * established for S1.
 *
 * ## What the screen has to communicate, and how it does it
 *
 * On Tiers B and C nobody has confirmed anything: the server ran the scan with
 * `--yes`, which included every package it found. So the central honesty
 * problem is telling a PROPOSAL apart from a DECISION. Three affordances carry
 * that, and none of them is colour alone:
 *
 *  - each row states what the detector actually found ("domain, infrastructure"
 *    or a plain "None found"), never a confidence score — the detector records
 *    only aliases that exist on disk, so absence is a fact;
 *  - a row a human changed carries an "edited" badge, and its expanded panel
 *    offers "Reset to detected", so overruling the proposal is reversible;
 *  - unticking is exactly one click, in the first column, the same cost as
 *    ticking. Declining a proposal must never be more work than accepting it.
 *
 * ## Composed, not rebuilt
 *
 * `EntityDataGrid` (BF-2.1) is the table, including the expandable layer panel
 * and the below-`md` stacked-card layout. `ChipInput` (promoted by BF-1.4 for
 * this screen) is every layer directory list. `CountPills` (BF-2.3) is the
 * summary. `EmptyState` (BF-2.3) is the no-packages surface. `Checkbox`,
 * `Input`, `Badge` and `Button` come from `@hexagen/ui`. Nothing tabular,
 * chip-shaped or pill-shaped is written here.
 *
 * `ChoiceCardGroup` is deliberately NOT used: it is a single-choice radio
 * group, and this screen is N independent include/exclude decisions plus free
 * text. Reaching for it would have meant fighting its `role="radiogroup"`
 * semantics to express something they do not mean.
 */

export interface LayoutRatifyViewProps {
  rows: readonly LayoutRatifyRow[];
  /** Counts, per-row messages and the blocking reason — see `validateLayoutRows`. */
  validation: LayoutRatifyValidation;
  onToggleInclude: (packageRoot: string, include: boolean) => void;
  onRenameContext: (packageRoot: string, contextName: string) => void;
  onLayerDirectoriesChange: (
    packageRoot: string,
    layer: LayoutLayerName,
    directories: string[],
  ) => void;
  onResetRow: (packageRoot: string) => void;
  /** Carried project name, shown for orientation. */
  projectName?: string;
}

/** Sentence case for a layer key, for a label the user reads. */
const LAYER_LABELS: Record<LayoutLayerName, string> = {
  domain: "Domain",
  application: "Application",
  infrastructure: "Infrastructure",
  presentation: "Presentation",
};

/**
 * The reason each layer's chips are prefilled the way they are. Shown under
 * the input, so "empty" is never left ambiguous between "not found" and "we
 * did not look".
 */
function layerHint(row: LayoutRatifyRow, layer: LayoutLayerName): string {
  const detected = row.detectedLayerDirectories[layer];
  if (detected.length > 0) {
    return `Found on disk: ${detected.join(", ")}`;
  }
  return "Not found on disk. Add a directory if this layer lives somewhere the scan does not know about.";
}

/** "domain, infrastructure" — what the scan actually found for one package. */
function detectedLayerSummary(row: LayoutRatifyRow): string {
  const found = LAYOUT_LAYERS.filter(
    (layer) => row.detectedLayerDirectories[layer].length > 0,
  );
  return found.length === 0 ? "" : found.map((l) => LAYER_LABELS[l]).join(", ");
}

/** "domain, infrastructure" — what the row will actually be ratified with. */
function ratifiedLayerSummary(row: LayoutRatifyRow): string {
  const present = LAYOUT_LAYERS.filter(
    (layer) => row.layerDirectories[layer].length > 0,
  );
  return present.length === 0
    ? ""
    : present.map((l) => LAYER_LABELS[l]).join(", ");
}

function summaryPills(validation: LayoutRatifyValidation): CountPillItem[] {
  const pills: CountPillItem[] = [
    {
      id: "included",
      label: "included",
      count: validation.includedCount,
      // Zero included is the one state that cannot be ratified, so the pill
      // that carries the number is the pill that changes tone.
      tone: validation.includedCount === 0 ? "danger" : "positive",
    },
    { id: "excluded", label: "excluded", count: validation.excludedCount },
  ];
  if (validation.editedCount > 0) {
    pills.push({
      id: "edited",
      label: "edited by you",
      count: validation.editedCount,
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

export function LayoutRatifyView({
  rows,
  validation,
  onToggleInclude,
  onRenameContext,
  onLayerDirectoriesChange,
  onResetRow,
  projectName,
}: LayoutRatifyViewProps) {
  const headingId = useId();
  const instanceId = useId();

  /**
   * `aria-describedby` needs a stable element id per row, and a row key is a
   * package root — it holds slashes and dots, which are legal in an `id` but
   * hostile to anything that later selects on one. Index positionally instead,
   * exactly as `EntityDataGrid` does for its own detail rows.
   */
  const messageIds = useMemo(
    () =>
      new Map(
        rows.map((row, index) => [
          row.packageRoot,
          `${instanceId}-message-${index}`,
        ]),
      ),
    [rows, instanceId],
  );

  const columns: EntityDataGridColumn<LayoutRatifyRow>[] = [
    {
      id: "include",
      header: "Include",
      cell: (row) => (
        <Checkbox
          checked={row.include}
          onCheckedChange={(checked) =>
            onToggleInclude(row.packageRoot, checked)
          }
          aria-label={`Include ${row.packageRoot} as a bounded context`}
        />
      ),
    },
    {
      id: "package",
      header: "Package",
      cell: (row) => (
        <span className="font-mono text-sm break-all">{row.packageRoot}</span>
      ),
    },
    {
      id: "context",
      header: "Context name",
      cell: (row) => {
        const message = validation.rowMessages[row.packageRoot];
        const messageId = messageIds.get(row.packageRoot);
        const changes = layoutRowChanges(row);
        const isError = message?.severity === "error";
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={row.contextName}
                onChange={(event) =>
                  onRenameContext(row.packageRoot, event.target.value)
                }
                disabled={!row.include}
                aria-label={`Context name for ${row.packageRoot}`}
                aria-invalid={isError || undefined}
                aria-describedby={message ? messageId : undefined}
                className={cn(
                  "h-9 font-mono",
                  isError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
              {changes.renamed ? <Badge variant="outline">edited</Badge> : null}
            </div>
            {message ? (
              <p
                id={messageId}
                className={cn(
                  "text-xs",
                  message.severity === "error"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {message.text}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "layers",
      header: "Layers",
      cell: (row) => {
        const ratified = ratifiedLayerSummary(row);
        const detectedSummary = detectedLayerSummary(row);
        const changes = layoutRowChanges(row);
        return (
          <div className="space-y-1 text-sm">
            <p>{ratified === "" ? "None" : ratified}</p>
            {changes.layersEdited ? (
              <p className="text-xs text-muted-foreground">
                {detectedSummary === ""
                  ? "Scan found none — you added these."
                  : `Scan found: ${detectedSummary}`}
              </p>
            ) : null}
            {!changes.layersEdited && hasNoDetectedLayers(row) ? (
              <p className="text-xs text-muted-foreground">
                No known layer directory was found here.
              </p>
            ) : null}
          </div>
        );
      },
    },
  ];

  const renderExpandedRow = (row: LayoutRatifyRow) => {
    const changes = layoutRowChanges(row);
    return (
      <div className="space-y-3 pt-2">
        <p className="text-xs text-muted-foreground">
          {`Directories inside ${row.packageRoot}, relative to it. These become the \`layers\` block for this context; a layer left empty is written as absent rather than as an empty list.`}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {LAYOUT_LAYERS.map((layer) => (
            <div
              key={layer}
              role="group"
              // ChipInput renders its own <label>, but without an `htmlFor`, so
              // the label is not programmatically associated with its input.
              // Naming the wrapping group is the fix available inside this
              // packet's fence; the association itself is ChipInput's to fix.
              aria-label={`${LAYER_LABELS[layer]} directories for ${row.packageRoot}`}
            >
              <ChipInput
                label={LAYER_LABELS[layer]}
                name={`${row.packageRoot}:${layer}`}
                placeholder="e.g. src/domain"
                values={row.layerDirectories[layer]}
                onChange={(values) =>
                  onLayerDirectoriesChange(row.packageRoot, layer, values)
                }
              />
              <p className="-mt-2 mb-2 text-xs text-muted-foreground">
                {layerHint(row, layer)}
              </p>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onResetRow(row.packageRoot)}
          disabled={!changes.renamed && !changes.layersEdited}
        >
          {`Reset ${row.packageRoot} to what the scan detected`}
        </Button>
      </div>
    );
  };

  return (
    <section aria-labelledby={headingId} className="animate-fade-in-up">
      <h2 id={headingId} className="text-xl font-semibold text-foreground">
        {rows.length === 1
          ? "1 package found. Confirm whether it is a bounded context."
          : `${rows.length} packages found. Confirm the ones that are bounded contexts.`}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {projectName
          ? `These are proposals from the scan of ${projectName}, not assertions. Include only what you ratify — nothing is written until you continue.`
          : "These are proposals from the scan, not assertions. Include only what you ratify — nothing is written until you continue."}
      </p>

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={FolderSearch}
            headingLevel={3}
            title="No workspace packages were detected"
            description="There is nothing to ratify. Go back and try another way of reading the codebase — a repository without a workspace layout is scanned as a single package, so an empty result usually means the scan never reached the source."
          />
        </div>
      ) : (
        <>
          <div className="mt-4">
            <CountPills
              pills={summaryPills(validation)}
              label="Ratification counts"
            />
          </div>

          {/*
            The live region is ALWAYS mounted and only its contents change.
            A region that appears at the same moment as its text is unreliable
            in every screen reader — the node has to be observed before the
            mutation for the mutation to be announced. `role="status"` rather
            than `alert` because this blinks in and out as the user ticks
            boxes, and an assertive interrupt on every toggle would be hostile.
          */}
          <div role="status" aria-live="polite">
            {validation.blockingReason !== null ? (
              <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {validation.blockingReason}
              </p>
            ) : null}
          </div>

          <div className="mt-6">
            <EntityDataGrid
              rows={rows}
              columns={columns}
              rowKey={(row) => row.packageRoot}
              rowHeaderColumnId="package"
              // The visible <h2> above names this region, so a second visible
              // caption would repeat it. It stays in the accessibility tree
              // because a table without one is unnamed in a screen reader's
              // table list.
              caption="Detected packages and the bounded context each one is proposed as"
              captionAppearance="screen-reader-only"
              renderExpandedRow={renderExpandedRow}
              expandLabel={(row) => `Layer directories for ${row.packageRoot}`}
              rowVariant={(row) =>
                validation.rowMessages[row.packageRoot]?.severity === "error"
                  ? "critical"
                  : row.include
                    ? "default"
                    : "muted"
              }
            />
          </div>
        </>
      )}
    </section>
  );
}

export interface LayoutRatifyFooterActionsProps {
  validation: LayoutRatifyValidation;
  onBack: () => void;
  onContinue: () => void;
}

/**
 * The two footer buttons, for the page shell's `footer` slot.
 *
 * Lives here rather than in the page so the "may this be ratified?" question
 * has one answer: `validation.blockingReason`. A page that re-derived it would
 * drift from `validateLayoutRows` on the first rule added.
 *
 * The disabled button is described by the reason rather than being silently
 * inert — `aria-describedby` points at the same sentence the view renders, so
 * a keyboard user who lands on a dead Continue is told why it is dead.
 *
 * NOTE for whoever builds `/projects/new/import/ratify`: this belongs in
 * `ProjectsShellWithFreeTier`'s `footer` prop, never inside the content
 * column. Ratifying must go through the flow machine's `RATIFY_LAYOUT` event —
 * there is no navigation in this file, and there must not be one added here.
 */
export function LayoutRatifyFooterActions({
  validation,
  onBack,
  onContinue,
}: LayoutRatifyFooterActionsProps) {
  const reasonId = useId();
  const blocked = validation.blockingReason !== null;

  return (
    <>
      <Button variant="outline" onClick={onBack}>
        Back
      </Button>
      <div className="flex items-center gap-3">
        {blocked ? (
          <span id={reasonId} className="sr-only">
            {validation.blockingReason}
          </span>
        ) : null}
        <Button
          onClick={onContinue}
          disabled={blocked}
          aria-describedby={blocked ? reasonId : undefined}
        >
          Continue
        </Button>
      </div>
    </>
  );
}
