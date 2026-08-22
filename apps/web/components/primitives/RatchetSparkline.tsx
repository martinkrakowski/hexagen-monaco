import type { ReactNode } from "react";
import type { NoSemanticState } from "@hexagen/ui";
import { cn } from "@/lib/utils";

/**
 * RatchetSparkline (F-31) — the S6 trend visualisation.
 *
 * ## Why it lives in `components/` and takes everything through props
 *
 * `apps/web/components/` is a NEUTRAL home (ADR-0055 §Decision 2, enforced by
 * check 7 of `scripts/validate-ui-boundary.sh`): a module here may not import
 * from `features/**`, and that baseline is shrink-only. So this component
 * knows nothing about scans, verdicts, `ScanTrendPoint` or the platform store.
 * It is handed a list of labelled numbers — some of which may be MISSING — and
 * draws them. `features/brownfield/Report/report-summary.ts` is what turns a
 * scan history into that list, and the direction of that dependency is what
 * lets a second consumer (a future project dashboard) reuse this without
 * dragging the brownfield slice in behind it.
 *
 * It is also inside the `components/**` ESLint block, so
 * `hexagen-ui/no-arbitrary-tailwind-values` applies: every spacing class below
 * is on the DESIGN.md §4.7 scale (1, 2, 3, 4, 6, 8, 12, 16 — note 5 is NOT on
 * it), and the chart geometry is expressed in SVG viewBox units and SVG
 * attributes, never in a bracketed Tailwind class.
 *
 * ## What it refuses to draw
 *
 * A sparkline is a claim that a quantity MOVED. Three inputs cannot support
 * that claim, and each gets its own answer rather than a chart:
 *
 *  - **no points at all** → `emptyLabel`. Nothing to plot and nothing to say
 *    about a direction.
 *  - **fewer than two MEASURED points** → no `<svg>` at all. One sample drawn
 *    as a line is a flat line, and a flat line reads as "stable" — a trend
 *    asserted from a single observation. Instead the table below becomes the
 *    visible representation and `insufficientLabel` says why there is no
 *    chart. This is the "one data point" case, and it is deliberately not a
 *    degenerate chart.
 *  - **a point with `value: null`** → an UNMEASURED slot. It keeps its
 *    position on the x-axis and is drawn as a dashed full-height rule, never
 *    as a y-value. This is the same defect class the scan contract calls out:
 *    a scan that could not run reports zero findings, and plotting that zero
 *    would draw an improvement that never happened. A gap cannot be misread as
 *    a value; a zero can.
 *
 * The x-axis is SCAN ORDER, evenly spaced — not elapsed time. Two scans a
 * minute apart and two scans a month apart get the same spacing, and the
 * caption/table carry the real timestamps. Time-proportional spacing inside a
 * 64px-tall strip collapses clustered runs into a single unreadable smear, and
 * the question this chart answers ("is the ratchet moving the right way across
 * runs?") is ordinal, not temporal.
 *
 * ## Accessibility — the table IS the chart
 *
 * The `<svg>` is `aria-hidden`. The data reaches assistive technology as a
 * real `<table>`: one row per scan, the scan label as `<th scope="row">`, the
 * value (or the reason it is missing) in the cell, and `label` naming the
 * table so it is identifiable in a screen reader's table list — as a real
 * `<caption>` when the table is on screen, as `aria-label` when it is standing
 * in for the chart (see `TrendTable`).
 *
 * `role="img"` + a summarising `aria-label` was considered and rejected. A
 * label is ONE linear utterance: a listener cannot re-read a single value,
 * cannot correlate a number back to the scan it came from, cannot skip to the
 * end, and gets nothing for the unmeasured slots except a comma. At six points
 * that label is already an unstructured 200-character sentence; at fifty it is
 * unusable. A table gives row/column navigation, exact values and per-row
 * notes, and it degrades by getting longer rather than by getting useless.
 *
 * `@/primitives/EntityDataGrid` was considered for that table and rejected:
 * it flips `display` below `md` and re-emits every column header as a
 * `md:hidden` per-cell label, so inside an `sr-only` wrapper what gets
 * announced would change with the viewport width — the opposite of what a
 * text equivalent is for. It is also a client component with expansion state,
 * which a six-row static table does not need.
 *
 * The `<figcaption>` is VISIBLE and carries the host's trend sentence. That is
 * deliberate: the summary is the useful part for everyone, and burying it in
 * an aria-label would make sighted readers infer from pixels what could simply
 * be written down.
 *
 * No `"use client"` directive: props in, markup out, no state, no effects, no
 * hooks (DESIGN.md §5.5).
 */

/** The chart's coordinate space. viewBox units, not pixels, not Tailwind. */
export const SPARKLINE_VIEW_WIDTH = 100;
export const SPARKLINE_VIEW_HEIGHT = 32;
/**
 * Inset so the end markers and the stroke are not clipped by the viewBox edge.
 * In viewBox units — the rendered size comes from the `h-16 w-full` classes,
 * which ARE on the §4.7 scale.
 */
const SPARKLINE_PADDING = 3;

export interface RatchetSparklinePoint {
  /** Stable React key. Never rendered. */
  readonly id: string;
  /** Row name in the text equivalent, e.g. "20 Aug 2026, 14:02". */
  readonly label: string;
  /**
   * The measurement, or `null` when this scan produced no trustworthy number.
   *
   * `null` is not zero and is never plotted as one. A caller that mapped an
   * unusable reading to `0` would be asking this component to draw an
   * improvement that did not happen.
   */
  readonly value: number | null;
  /**
   * Why the value is missing, for the table cell. Only read when `value` is
   * `null`; a default stands in when it is absent, because an unexplained
   * blank in a data table is how a gap gets mistaken for a zero.
   */
  readonly note?: string;
}

export interface SparklineVertex {
  readonly x: number;
  readonly y: number;
}

export interface RatchetSparklineChart {
  readonly kind: "chart";
  /**
   * One entry per contiguous run of measured points, as an SVG `points`
   * string. Runs are separate polylines rather than one path with moves, so
   * the renderer never draws a segment ACROSS an unmeasured scan — an
   * interpolated line over a gap is a fabricated measurement.
   */
  readonly polylines: readonly string[];
  /** Measured points with no measured neighbour; a polyline of one is invisible. */
  readonly dots: readonly SparklineVertex[];
  /** x positions of unmeasured slots, drawn as full-height dashed rules. */
  readonly gapX: readonly number[];
  /** The most recent measured point — the "you are here" marker. */
  readonly lastVertex: SparklineVertex;
  readonly measuredCount: number;
  readonly totalCount: number;
}

export type RatchetSparklinePlan =
  | { readonly kind: "empty" }
  | {
      readonly kind: "insufficient";
      readonly measuredCount: number;
      readonly totalCount: number;
    }
  | RatchetSparklineChart;

/** Two decimals. Keeps the emitted DOM stable across platforms and readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Decides whether these points may be drawn at all, and where each one sits.
 *
 * Exported and pure so the zero / one / many decision can be exercised without
 * a DOM — the branch that matters most here is the one that renders NOTHING,
 * and a rendering test can only ever assert the absence of an element.
 *
 * The y-scale spans the measured values only (`min`..`max`), so the chart uses
 * its full height for the range that actually occurred. It is NOT zero-based:
 * a ratchet trend is read for its direction and its shape, and anchoring at
 * zero flattens a 41→7 collapse into an invisible wiggle. The exact numbers
 * live in the table, which is why flattening them here would be the wrong
 * trade and reading them off the pixels is never required.
 *
 * A series where every measured value is identical is drawn at mid-height
 * rather than at the floor or the ceiling: it is genuinely flat, and pinning
 * it to an edge would imply a best-case or worst-case reading that the data
 * does not carry.
 */
export function planRatchetSparkline(
  points: readonly RatchetSparklinePoint[],
): RatchetSparklinePlan {
  const totalCount = points.length;
  if (totalCount === 0) return { kind: "empty" };

  const measured: number[] = [];
  for (const point of points) {
    // Guards the wire, not the type: a NaN or an Infinity arriving from a
    // parsed payload would poison min/max and blank the whole chart, so it is
    // treated exactly like an absent reading.
    if (typeof point.value === "number" && Number.isFinite(point.value)) {
      measured.push(point.value);
    }
  }

  const measuredCount = measured.length;
  if (measuredCount < 2) {
    return { kind: "insufficient", measuredCount, totalCount };
  }

  const min = Math.min(...measured);
  const max = Math.max(...measured);
  const span = max - min;

  const usableWidth = SPARKLINE_VIEW_WIDTH - SPARKLINE_PADDING * 2;
  const usableHeight = SPARKLINE_VIEW_HEIGHT - SPARKLINE_PADDING * 2;

  const xAt = (index: number): number =>
    totalCount === 1
      ? SPARKLINE_VIEW_WIDTH / 2
      : SPARKLINE_PADDING + (index / (totalCount - 1)) * usableWidth;

  const yAt = (value: number): number =>
    span === 0
      ? SPARKLINE_VIEW_HEIGHT / 2
      : SPARKLINE_PADDING + (1 - (value - min) / span) * usableHeight;

  const polylines: string[] = [];
  const dots: SparklineVertex[] = [];
  const gapX: number[] = [];
  let run: SparklineVertex[] = [];
  let lastVertex: SparklineVertex | null = null;

  const flush = (): void => {
    if (run.length >= 2) {
      polylines.push(run.map((v) => `${v.x},${v.y}`).join(" "));
    } else if (run.length === 1) {
      dots.push(run[0]);
    }
    run = [];
  };

  // A plain `for` rather than `forEach`: `lastVertex` is read after the loop,
  // and TypeScript does not track assignments made inside a callback, so the
  // narrowed type at the read site would be `null` and the invariant below
  // would have to be asserted away with a `!`.
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const x = round(xAt(index));
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) {
      flush();
      gapX.push(x);
      continue;
    }
    const vertex = { x, y: round(yAt(point.value)) };
    run.push(vertex);
    lastVertex = vertex;
  }
  flush();

  return {
    kind: "chart",
    polylines,
    dots,
    gapX,
    // Non-null by construction: `measuredCount >= 2` was checked above, so at
    // least one vertex was assigned. The assertion is spelled out rather than
    // left to `!` so the invariant is stated where it is relied on.
    lastVertex: lastVertex ?? { x: 0, y: SPARKLINE_VIEW_HEIGHT / 2 },
    measuredCount,
    totalCount,
  };
}

/**
 * Branded `NoSemanticState`, matching its neighbour `StageProgressList.tsx`.
 * `components/` is outside check 3 of validate-ui-boundary.sh (which walks
 * packages/ui/src and components/primitives only), so the brand here is a
 * TYPE-LEVEL statement rather than a gate-enforced one: this component is
 * presentation-only, and a future prop called `status` or `data` should fail
 * to compile rather than wait for a reviewer to notice.
 */
export type RatchetSparklineProps = NoSemanticState<{
  readonly points: readonly RatchetSparklinePoint[];
  /**
   * Names the text-equivalent table, e.g. "Findings failing the gate, by scan".
   * Rendered as the `<caption>`, so it is what a screen reader announces when
   * it lands on the table.
   */
  readonly label: string;
  /**
   * The visible trend sentence, authored by the host. Rendered as the
   * `<figcaption>` and shown to everyone.
   */
  readonly summary?: ReactNode;
  /** Header for the scan column. */
  readonly pointHeader?: string;
  /** Header for the value column. */
  readonly valueHeader?: string;
  /**
   * Shown instead of a chart when there are fewer than two measured points.
   * A default is supplied so the honest branch cannot be lost by a caller who
   * forgot the prop; hosts with a better sentence pass their own.
   */
  /**
   * Narrowed to `string`, not `ReactNode`, on purpose. Both label props are
   * rendered inside a `<p>`; a caller passing block content (a `<div>`, a
   * list) would produce invalid DOM nesting, which browsers "fix" by
   * restructuring the tree -- so the bug surfaces as mangled layout far from
   * its cause. These are single explanatory sentences by contract, and every
   * caller already passes a string, so the compiler may as well enforce it.
   */
  readonly insufficientLabel?: string;
  /** Shown when there are no points at all. */
  readonly emptyLabel?: string;
  /** Cell text for an unmeasured point that carried no `note`. */
  readonly unmeasuredLabel?: string;
  readonly className?: string;
}>;

/**
 * A note counts only if it actually says something.
 *
 * `note` reaches this component from a payload, and "" is a very ordinary
 * thing for a serializer to produce where a caller meant "absent". Treating
 * it as present renders an empty cell, which reads as a value rather than as
 * a missing reading -- the exact confusion the unmeasured label exists to
 * prevent.
 */
function normalizeNote(note: string | undefined): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  return trimmed === "" ? null : trimmed;
}

function TrendTable({
  points,
  label,
  pointHeader,
  valueHeader,
  unmeasuredLabel,
  visible,
}: {
  points: readonly RatchetSparklinePoint[];
  label: string;
  pointHeader: string;
  valueHeader: string;
  unmeasuredLabel: string;
  /**
   * `false` puts the table in the accessibility tree only — it is the text
   * equivalent of a chart that is already on screen. `true` makes it the sole
   * representation, for the branches where no chart is drawn.
   */
  visible: boolean;
}) {
  return (
    <div className={visible ? "w-full overflow-x-auto" : "sr-only"}>
      {/*
        The table is named twice over, but never at the same time.

        VISIBLE: a real `<caption>`, which names the table in a screen reader's
        table list AND puts a heading on it for sighted readers.

        SCREEN-READER-ONLY: `aria-label`, and NO caption. Both would name it
        the same thing and then read the caption again as the table's first
        content, so the listener hears the title twice for a table they cannot
        see. `aria-label` rather than `aria-labelledby` because naming by id
        needs a generated id, which needs `useId`, which would make this a
        client component for no behaviour.
      */}
      <table
        className="w-full text-left text-sm"
        aria-label={visible ? undefined : label}
      >
        {visible ? (
          <caption className="pb-2 text-left text-sm text-muted-foreground">
            {label}
          </caption>
        ) : null}
        <thead>
          <tr>
            <th scope="col" className="p-2 font-medium text-muted-foreground">
              {pointHeader}
            </th>
            <th scope="col" className="p-2 font-medium text-muted-foreground">
              {valueHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.id}>
              <th
                scope="row"
                className="p-2 font-normal text-foreground align-top"
              >
                {point.label}
              </th>
              <td className="p-2 text-foreground align-top">
                {/*
                  A missing reading is spelled out in words, never left blank
                  and never rendered as 0. The dashed rule in the chart and
                  this cell have to agree, or the two representations disagree
                  about whether a scan happened.
                */}
                {typeof point.value === "number" && Number.isFinite(point.value)
                  ? String(point.value)
                  : /*
                      `??` would only catch null/undefined, so a note of ""
                      (or whitespace) fell through as itself and rendered an
                      EMPTY cell -- breaking the guarantee stated directly
                      above, in the one place it matters most. A blank cell
                      beside populated ones reads as "nothing was wrong here",
                      which is the opposite of "no reading was taken".
                    */
                    (normalizeNote(point.note) ?? unmeasuredLabel)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RatchetSparkline({
  points,
  label,
  summary,
  pointHeader = "Scan",
  valueHeader = "Findings",
  insufficientLabel,
  emptyLabel = "No scans recorded yet, so there is no trend to show.",
  unmeasuredLabel = "not measured",
  className,
}: RatchetSparklineProps) {
  const plan = planRatchetSparkline(points);

  if (plan.kind === "empty") {
    return (
      <figure className={cn("flex flex-col gap-2", className)}>
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        {summary === undefined ? null : (
          <figcaption className="text-sm text-muted-foreground">
            {summary}
          </figcaption>
        )}
      </figure>
    );
  }

  if (plan.kind === "insufficient") {
    const fallback =
      plan.measuredCount === 1
        ? "Only one scan has a usable measurement, so there is nothing to compare it with yet. A trend needs at least two."
        : "No scan so far produced a usable measurement, so there is no trend to draw.";
    return (
      <figure className={cn("flex flex-col gap-3", className)}>
        <p className="text-sm text-muted-foreground">
          {insufficientLabel ?? fallback}
        </p>
        {/*
          The table is VISIBLE here. It is not a fallback for a chart -- there
          is no chart -- it is the only honest rendering of one or zero
          measurements, and hiding it would leave the screen asserting a
          history it refuses to show.
        */}
        <TrendTable
          points={points}
          label={label}
          pointHeader={pointHeader}
          valueHeader={valueHeader}
          unmeasuredLabel={unmeasuredLabel}
          visible
        />
        {summary === undefined ? null : (
          <figcaption className="text-sm text-muted-foreground">
            {summary}
          </figcaption>
        )}
      </figure>
    );
  }

  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <svg
        // The only marker a test can hang on: the svg is aria-hidden, so it is
        // unreachable by role or name BY DESIGN, and "no chart was drawn" is
        // the assertion that matters most on this component.
        data-testid="ratchet-sparkline"
        // aria-hidden, and not by omission: the <table> below is the text
        // equivalent, and leaving the svg in the accessibility tree would make
        // a screen reader announce an unnamed graphic before the real data.
        aria-hidden="true"
        focusable="false"
        className="h-16 w-full text-primary"
        viewBox={`0 0 ${SPARKLINE_VIEW_WIDTH} ${SPARKLINE_VIEW_HEIGHT}`}
        // The strip is wider than it is tall and stretches with its container,
        // so uniform scaling would letterbox it. `none` distorts geometry;
        // `vector-effect="non-scaling-stroke"` below keeps the stroke weight
        // constant so the distortion never reaches the line thickness.
        preserveAspectRatio="none"
      >
        {plan.gapX.map((x) => (
          <line
            key={`gap-${x}`}
            x1={x}
            x2={x}
            y1={0}
            y2={SPARKLINE_VIEW_HEIGHT}
            className="text-muted-foreground"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {plan.polylines.map((pointsAttr) => (
          <polyline
            key={pointsAttr}
            points={pointsAttr}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {plan.dots.map((dot) => (
          <circle
            key={`dot-${dot.x}-${dot.y}`}
            cx={dot.x}
            cy={dot.y}
            r={1.5}
            fill="currentColor"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <circle
          cx={plan.lastVertex.x}
          cy={plan.lastVertex.y}
          r={2}
          fill="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <TrendTable
        points={points}
        label={label}
        pointHeader={pointHeader}
        valueHeader={valueHeader}
        unmeasuredLabel={unmeasuredLabel}
        visible={false}
      />
      {summary === undefined ? null : (
        <figcaption className="text-sm text-muted-foreground">
          {summary}
        </figcaption>
      )}
    </figure>
  );
}
