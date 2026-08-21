import { cva } from "class-variance-authority";
import {
  CircleCheck,
  CircleMinus,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import type { NoSemanticState } from "@hexagen/ui";
import { cn } from "@/lib/utils";

/**
 * A compact row of labelled counts.
 *
 * Consumers in this arc: the S6 report dashboard (fresh / baselined / stale /
 * expired) and the S5 sticky footer ("27 baselined - 7 fresh"). The two want
 * the same numbers in two shapes, so appearance is a CVA variant rather than a
 * second component (DESIGN.md 5.3).
 *
 * SEVERITY PROP IS NAMED `tone`, NOT `status`. `status` is a forbidden
 * information-state prop name in this directory
 * (scripts/firewall-blocklist.yaml, enforced twice: the
 * `hexagen-ui/no-information-state` ESLint rule reads JSX attributes, check 3
 * of scripts/validate-ui-boundary.sh reads prop declarations). `tone` is also
 * the honest name: the component is told how to *paint* a count, it does not
 * track anything. Whether "fresh" is bad this week is the caller's judgement.
 *
 * WHY NOT `@hexagen/ui`'s `Badge` (DESIGN.md 5.2 step 4 requires this to be
 * written down):
 *
 *  1. `Badge`'s variant set is `default | secondary | destructive | outline`.
 *     There is no `warning` and no `success`, and this row needs four distinct
 *     severities. The Tailwind theme *does* define `warning` and `success`
 *     (DESIGN.md 4.3), so the colours exist -- the variant vocabulary does not.
 *  2. `Badge` composes its className as
 *     `[badgeVariants({variant}), className].join(" ")` -- a plain string
 *     concatenation with no tailwind-merge. Passing `bg-warning` alongside a
 *     variant that already emits `bg-secondary` leaves both classes on the
 *     element and lets stylesheet source order decide the winner, which is not
 *     a contract anyone can rely on.
 *  3. `Badge` renders a `div`. Each count here is a list item, so that the row
 *     is a list to assistive tech and the decorative separators can be dropped
 *     from the accessible tree individually.
 *
 * The geometry classes below are copied from `badgeVariants` on purpose, so a
 * pill and a `Badge` sit at the same height and radius side by side.
 *
 * ACCESSIBILITY (binding, from the feature plan's cross-cutting section):
 *
 *  - Severity is never colour alone. Every tone carries its own Lucide glyph
 *    (distinct shapes, not four recolourings of one circle), and the two
 *    actionable tones additionally carry a screen-reader-only phrase.
 *  - Each count reads as one contiguous run -- "7 fresh", not "7" and then a
 *    "fresh" adrift from it -- because the number and the label are separated
 *    by a real space text node inside a single list item. That is what lets
 *    the S5 consumer drop this row inside `aria-live="polite"` and get a
 *    sentence rather than a bag of numbers.
 *  - The inline separators are `aria-hidden` list items, so the live region
 *    never announces a middle dot.
 *
 * No `use client` directive: renders from props only (DESIGN.md 5.5).
 */
export type CountPillTone = "neutral" | "positive" | "warning" | "danger";

export interface CountPillItem {
  /** Stable React key. */
  id: string;
  /** Lower-case noun read straight after the number, e.g. "fresh". */
  label: string;
  count: number;
  /** How to paint it. Defaults to "neutral". */
  tone?: CountPillTone;
}

export type CountPillsProps = NoSemanticState<{
  pills: readonly CountPillItem[];
  /**
   * "pill" -- filled chips, for the S6 dashboard.
   * "inline" -- bare text separated by a middle dot, for the S5 sticky footer.
   */
  appearance?: "pill" | "inline";
  /** Accessible name for the row, e.g. "Finding counts". */
  label?: string;
  /** Extra classes for the row container. */
  className?: string;
}>;

/**
 * One glyph per tone, chosen for distinct silhouettes so the severity survives
 * greyscale, colour-blindness and a low-contrast projector.
 */
const TONE_ICONS: Record<CountPillTone, LucideIcon> = {
  neutral: CircleMinus,
  positive: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
};

/**
 * Screen-reader-only suffix for the tones that mean "do something". Neutral and
 * positive get none: adding "fine" to every count would make the live region
 * chattier without saying anything.
 */
const TONE_HINTS: Record<CountPillTone, string | null> = {
  neutral: null,
  positive: null,
  warning: "needs attention",
  danger: "action required",
};

/**
 * Row container. Not a CVA -- both appearances want the same 8px rhythm, and a
 * variant whose arms are identical reads as a decision that was never made.
 */
const ROW_CLASSES = "flex flex-wrap items-center gap-2";

const pillVariants = cva("inline-flex items-center gap-1 text-xs font-medium", {
  variants: {
    appearance: {
      // Geometry mirrors badgeVariants (rounded-full + px-2 + py-1 + text-xs)
      // so these line up with a real Badge.
      pill: "rounded-full border border-transparent px-2 py-1",
      inline: "",
    },
    // Colour is set by the compound pairs below, not here, so no two classes
    // in the emitted string ever target the same property.
    tone: {
      neutral: "",
      positive: "",
      warning: "",
      danger: "",
    },
  },
  compoundVariants: [
    {
      appearance: "pill",
      tone: "neutral",
      class: "bg-secondary text-secondary-foreground",
    },
    {
      appearance: "pill",
      tone: "positive",
      class: "bg-success text-success-foreground",
    },
    {
      appearance: "pill",
      tone: "warning",
      class: "bg-warning text-warning-foreground",
    },
    {
      // DESIGN.md 4.4 reserves bg-destructive for danger, and forbids it for
      // primary CTAs only. An expired waiver is exactly the danger case.
      appearance: "pill",
      tone: "danger",
      class: "bg-destructive text-destructive-foreground",
    },
    { appearance: "inline", tone: "neutral", class: "text-muted-foreground" },
    { appearance: "inline", tone: "positive", class: "text-success" },
    { appearance: "inline", tone: "warning", class: "text-warning" },
    { appearance: "inline", tone: "danger", class: "text-destructive" },
  ],
  defaultVariants: { appearance: "pill", tone: "neutral" },
});

export function CountPills({
  pills,
  appearance = "pill",
  label,
  className,
}: CountPillsProps) {
  return (
    <ul
      aria-label={label}
      // cn(), not a string join -- see the note in the Badge rationale above:
      // a join leaves a host override and the base class both present, and
      // source order picks the winner instead of the caller.
      className={cn(ROW_CLASSES, className)}
    >
      {pills.map((pill, index) => {
        const tone = pill.tone ?? "neutral";
        const ToneIcon = TONE_ICONS[tone];
        const hint = TONE_HINTS[tone];

        return (
          <Fragment key={pill.id}>
            {appearance === "inline" && index > 0 ? (
              // A decorative divider, not a count. aria-hidden keeps it out of
              // the accessible tree entirely, so `getAllByRole("listitem")` --
              // and a screen reader reading the live region -- sees only the
              // real entries.
              <li aria-hidden="true" className="text-xs text-muted-foreground">
                &middot;
              </li>
            ) : null}
            <li data-tone={tone} className={pillVariants({ appearance, tone })}>
              <ToneIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="tabular-nums font-semibold">{pill.count}</span>
              {/*
                The separating space lives INSIDE the label span rather than as
                a bare `{" "}` between two flex items -- a whitespace-only
                anonymous flex item is dropped by the layout algorithm, which
                would leave the item's text content as "7fresh". Visual spacing
                comes from the item's own `gap-1`, so nothing is doubled.
              */}
              <span>{` ${pill.label}`}</span>
              {hint ? <span className="sr-only">{`, ${hint}`}</span> : null}
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
