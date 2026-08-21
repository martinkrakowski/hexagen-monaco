"use client";

import { Fragment, useCallback, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cva } from "class-variance-authority";
import { Icon } from "@hexagen/ui";
import type { NoSemanticState } from "@hexagen/ui";

/**
 * EntityDataGrid — the tabular primitive `@hexagen/ui` does not have.
 *
 * DESIGN.md §3.2 mandates this exact name: `Table`, `List` and `DataThing` are
 * prohibited for data grids. DESIGN.md §5.2 puts custom Tailwind markup last,
 * so the documentation this file owes (§5.2 point 4) is: there is no table,
 * no row, and no disclosure-inside-a-row primitive anywhere in `@hexagen/ui`
 * (elements/ is Button, Card, Input, Badge, Label, Textarea, Icon, Checkbox,
 * Spinner, Skeleton, CopyButton; modules/ is Tabs, Accordion, Tooltip,
 * ViewToggle, FileDropZone; sections/ is Dialog). `Accordion` is the closest
 * shape and is deliberately NOT reused: it renders div/button disclosures with
 * no column structure, so a screen-reader user gets no row/column relationship
 * and no header association — the two things a ratification screen is entirely
 * about. `Icon` IS reused for the expander chevron.
 *
 * Presentation-only, per `apps/web/components/primitives/**` being fenced by
 * both firewall layers (eslint `hexagen-ui/no-information-state` on JSX
 * attributes, check 3 of `scripts/validate-ui-boundary.sh` on prop
 * declarations). It renders rows it is handed and raises intents; it never
 * fetches, sorts, filters or paginates. Hence `rows`, never `data`.
 *
 * `"use client"` is not preemptive (DESIGN.md §5.5): the expander owns real
 * `useState` when the host does not control expansion, and an onClick handler.
 */

export type EntityDataGridAlign = "start" | "end";

export type EntityDataGridDensity = "comfortable" | "compact";

export type EntityDataGridRowVariant =
  | "default"
  | "muted"
  | "attention"
  | "critical";

export type EntityDataGridCaptionAppearance = "visible" | "screen-reader-only";

/**
 * One column. `cell` is a render function rather than a key into the row so a
 * column can compose `@hexagen/ui` primitives (a Checkbox, a Badge, a
 * ChipInput) instead of being limited to text.
 */
export interface EntityDataGridColumn<TRow> {
  /** Stable identity; also the React key for every cell in the column. */
  id: string;
  /** Column header. Rendered in `<th scope="col">`, and again as the
   *  per-cell label in the stacked-card layout below `md`. */
  header: ReactNode;
  /** Renders the cell body for one row. */
  cell: (row: TRow) => ReactNode;
  /**
   * Header carries no useful visible text (a checkbox column, an actions
   * column). It stays in the accessibility tree via `sr-only` rather than
   * being dropped — an unnamed column is a worse outcome than a redundant one.
   */
  headerHidden?: boolean;
  /** Horizontal alignment. Numerics and actions usually want `"end"`. */
  align?: EntityDataGridAlign;
}

export type EntityDataGridProps<TRow> = NoSemanticState<{
  /**
   * The entities to render, one row each.
   *
   * NOT `data` — that name is one of the eleven the information-state firewall
   * rejects in this directory, in both prop declarations (check 3 of
   * validate-ui-boundary.sh) and JSX attributes (hexagen-ui/no-information-state).
   */
  rows: readonly TRow[];
  columns: ReadonlyArray<EntityDataGridColumn<TRow>>;
  /** Stable React key + expansion identity for a row. */
  rowKey: (row: TRow) => string;
  /**
   * Required. A `<table>` without a caption is an unnamed landmark in a
   * screen reader's table list; making it optional would mean shipping that by
   * default. Hosts that genuinely have a visible heading directly above the
   * grid pass `captionAppearance="screen-reader-only"` instead of omitting it.
   */
  caption: ReactNode;
  captionAppearance?: EntityDataGridCaptionAppearance;
  /**
   * Column whose cell becomes `<th scope="row">` for each row. Opt-in, and
   * deliberately not defaulted to the first column: on the S3 layout screen
   * the first column is an include checkbox, and "checkbox" is a useless row
   * name. Point it at the column that actually identifies the entity.
   */
  rowHeaderColumnId?: string;
  /**
   * Renders the expanded detail for a row. Supplying it is what turns on the
   * expander column; without it no disclosure control is rendered at all.
   */
  renderExpandedRow?: (row: TRow) => ReactNode;
  /**
   * Controlled expansion. When omitted the grid keeps its own expansion set,
   * so a host that only needs disclosure does not have to hold a reducer.
   */
  expandedRowKeys?: readonly string[];
  defaultExpandedRowKeys?: readonly string[];
  onExpandedChange?: (rowKey: string, isExpanded: boolean) => void;
  /**
   * Accessible name for one row's expander, e.g.
   * `(pkg) => \`Layer directories for ${pkg.root}\``. A single shared label
   * would give every expander on the page the same name.
   */
  expandLabel?: (row: TRow) => string;
  /** Shown in place of rows when `rows` is empty. */
  emptyLabel?: ReactNode;
  density?: EntityDataGridDensity;
  /** Per-row emphasis. Interaction/appearance intent, never a domain verdict. */
  rowVariant?: (row: TRow) => EntityDataGridRowVariant;
  /** Layout hints from the host for the outer wrapper. */
  className?: string;
}>;

/*
 * Responsive strategy — one DOM tree, not two.
 *
 * Below `md` the table elements are switched to `display: block` so each row
 * stacks into a card and the page body never scrolls sideways. Flipping a
 * table's display property STRIPS its implicit ARIA semantics in every major
 * browser, so every element carries its native role explicitly
 * (`table`/`rowgroup`/`row`/`columnheader`/`rowheader`/`cell`) to put them
 * back. That is the documented remedy for this exact pattern.
 *
 * `role="grid"` is NOT used, here or anywhere below. `grid` promises full
 * two-dimensional arrow-key navigation with a single tab stop; this component
 * implements none of that, and a role that lies about the keyboard contract is
 * worse for a screen-reader user than the plain table role that tells the
 * truth.
 *
 * The alternative — rendering a table for wide viewports and a separate card
 * list for narrow ones — was rejected: it doubles the markup, and either both
 * copies reach the accessibility tree or the hidden one silently rots.
 */

const gridVariants = cva("w-full border-collapse block md:table text-sm");

const captionVariants = cva("text-left", {
  variants: {
    appearance: {
      visible: "block md:table-caption pb-2 text-sm text-muted-foreground",
      "screen-reader-only": "sr-only",
    },
  },
  defaultVariants: { appearance: "visible" },
});

const rowVariants = cva(
  [
    // Card below `md`, table row from `md` up.
    "block md:table-row",
    "mb-3 rounded-lg border border-border p-4",
    "md:mb-0 md:rounded-none md:border-none md:p-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-card md:bg-transparent",
        muted: "bg-muted/40 text-muted-foreground",
        attention: "bg-warning/10",
        critical: "bg-destructive/10",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const cellVariants = cva(
  [
    "block md:table-cell align-top break-words",
    "md:border-b md:border-border",
  ].join(" "),
  {
    variants: {
      density: {
        comfortable: "py-2 md:px-3 md:py-3",
        compact: "py-1 md:px-2 md:py-2",
      },
      align: {
        start: "text-left",
        end: "text-left md:text-right",
      },
    },
    defaultVariants: { density: "comfortable", align: "start" },
  },
);

const headerCellVariants = cva(
  [
    "border-b border-border pb-2 text-xs font-medium text-muted-foreground",
    "md:px-3 md:py-2",
  ].join(" "),
  {
    variants: {
      align: {
        start: "text-left",
        end: "text-right",
      },
    },
    defaultVariants: { align: "start" },
  },
);

// DESIGN.md §4.8 focus ring, verbatim, plus the press feedback that is the one
// documented arbitrary-value exception.
const EXPANDER_CLASS = [
  "inline-flex items-center justify-center rounded-md p-1",
  "text-muted-foreground transition-colors",
  "hover:bg-accent hover:text-foreground",
  "active:scale-[0.98] active:opacity-90",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
].join(" ");

function joinClasses(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

export function EntityDataGrid<TRow>({
  rows,
  columns,
  rowKey,
  caption,
  captionAppearance = "visible",
  rowHeaderColumnId,
  renderExpandedRow,
  expandedRowKeys,
  defaultExpandedRowKeys,
  onExpandedChange,
  expandLabel,
  emptyLabel = "Nothing to show yet.",
  density = "comfortable",
  rowVariant,
  className,
}: EntityDataGridProps<TRow>) {
  const instanceId = useId();

  const [uncontrolledKeys, setUncontrolledKeys] = useState<readonly string[]>(
    () => defaultExpandedRowKeys ?? [],
  );
  const isControlled = expandedRowKeys !== undefined;
  // `??` rather than `isControlled ? … : …` so the narrowing does not depend on
  // TypeScript's aliased-condition analysis.
  const effectiveKeys = expandedRowKeys ?? uncontrolledKeys;

  const expandedSet = useMemo(
    () => new Set(effectiveKeys),
    // A new Set per render would be cheap, but memoising on the array keeps the
    // row map from re-deriving membership for every row on unrelated renders.
    [effectiveKeys],
  );

  const toggleRow = useCallback(
    (key: string, nextExpanded: boolean) => {
      if (!isControlled) {
        setUncontrolledKeys((current) =>
          nextExpanded
            ? [...current, key]
            : current.filter((candidate) => candidate !== key),
        );
      }
      onExpandedChange?.(key, nextExpanded);
    },
    [isControlled, onExpandedChange],
  );

  const isExpandable = typeof renderExpandedRow === "function";
  const columnCount = columns.length + (isExpandable ? 1 : 0);

  return (
    <div className={joinClasses("w-full", className)}>
      <table role="table" className={gridVariants()}>
        <caption
          role="caption"
          className={captionVariants({ appearance: captionAppearance })}
        >
          {caption}
        </caption>
        {/* Header row is display:none below `md` — its text reappears as the
            per-cell label inside each card, so the association survives. */}
        <thead role="rowgroup" className="hidden md:table-header-group">
          <tr role="row">
            {isExpandable && (
              <th
                role="columnheader"
                scope="col"
                className={headerCellVariants()}
              >
                <span className="sr-only">Details</span>
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.id}
                role="columnheader"
                scope="col"
                className={headerCellVariants({ align: column.align })}
              >
                {column.headerHidden ? (
                  <span className="sr-only">{column.header}</span>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="block md:table-row-group">
          {rows.length === 0 ? (
            <tr role="row" className="block md:table-row">
              <td
                role="cell"
                colSpan={columnCount}
                className="block md:table-cell p-4 text-sm text-muted-foreground"
              >
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const key = rowKey(row);
              const expanded = expandedSet.has(key);
              // Positional rather than key-derived: a row key is host-supplied
              // and may hold slashes or spaces, which are legal in an `id` but
              // hostile to anything that later selects on it.
              const detailId = `${instanceId}-detail-${index}`;

              return (
                <Fragment key={key}>
                  <tr
                    role="row"
                    className={rowVariants({
                      variant: rowVariant?.(row),
                    })}
                  >
                    {isExpandable && (
                      <td
                        role="cell"
                        className={cellVariants({ density })}
                      >
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={() => toggleRow(key, !expanded)}
                          className={EXPANDER_CLASS}
                        >
                          <Icon
                            name={expanded ? "chevron-down" : "chevron-right"}
                            size={16}
                            aria-hidden="true"
                          />
                          <span className="sr-only">
                            {expandLabel?.(row) ?? "Show details"}
                          </span>
                        </button>
                      </td>
                    )}
                    {columns.map((column) => {
                      const isRowHeader =
                        rowHeaderColumnId !== undefined &&
                        column.id === rowHeaderColumnId;
                      const cellClassName = cellVariants({
                        density,
                        align: column.align,
                      });
                      const label = column.headerHidden ? (
                        <span className="sr-only md:hidden">
                          {column.header}
                        </span>
                      ) : (
                        <span className="block text-xs font-medium text-muted-foreground md:hidden">
                          {column.header}
                        </span>
                      );
                      // The cell body is wrapped rather than emitted as a bare
                      // text node: below `md` the label sits above it in the
                      // card, and a wrapper is also what lets the value be
                      // addressed on its own instead of concatenated with its
                      // label in `textContent`. `div`, not `span`, because a
                      // column may render block content (a ChipInput row).
                      const body = (
                        <>
                          {label}
                          <div className="min-w-0 break-words">
                            {column.cell(row)}
                          </div>
                        </>
                      );

                      return isRowHeader ? (
                        <th
                          key={column.id}
                          role="rowheader"
                          scope="row"
                          className={joinClasses(
                            cellClassName,
                            "font-medium text-foreground",
                          )}
                        >
                          {body}
                        </th>
                      ) : (
                        <td
                          key={column.id}
                          role="cell"
                          className={cellClassName}
                        >
                          {body}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpandable && (
                    // Always in the DOM so `aria-controls` never dangles, but
                    // `renderExpandedRow` is only called while open. `hidden`
                    // is set as an ATTRIBUTE as well as a class: the class is
                    // what wins in the browser (an author `display` rule beats
                    // the UA sheet's `[hidden]`), the attribute is what holds
                    // in jsdom, where no stylesheet is loaded at all.
                    <tr
                      role="row"
                      id={detailId}
                      hidden={!expanded}
                      className={
                        expanded ? "block md:table-row" : "hidden"
                      }
                    >
                      <td
                        role="cell"
                        colSpan={columnCount}
                        className="block md:table-cell md:border-b md:border-border md:px-3 md:pb-3"
                      >
                        {expanded ? renderExpandedRow?.(row) : null}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
