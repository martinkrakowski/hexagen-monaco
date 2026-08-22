import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntityDataGrid } from "../EntityDataGrid";
import type {
  EntityDataGridColumn,
  EntityDataGridProps,
} from "../EntityDataGrid";

/**
 * `@testing-library/jest-dom` is a dependency of apps/web but `vitest.setup.ts`
 * deliberately does not import it, so `toBeInTheDocument` and `toHaveAttribute`
 * are UNREGISTERED matchers in this workspace. Every assertion below is plain
 * `toBe`/`toBeTruthy`/`toBeNull` over `getAttribute()` and `querySelector()`.
 *
 * No `import React` — apps/web's Vitest config compiles JSX with the automatic
 * runtime (`oxc.jsx.runtime`), and the sibling suite
 * `components/__tests__/StageProgressList.test.tsx` omits it for the same
 * reason. Importing it would be an unused binding, which pre-commit ESLint
 * treats as an error.
 */

interface DetectedPackageRow {
  root: string;
  contextName: string;
  layerDirs: readonly string[];
}

const PACKAGES: readonly DetectedPackageRow[] = [
  { root: "packages/orders", contextName: "orders", layerDirs: ["src/domain"] },
  { root: "packages/billing", contextName: "billing", layerDirs: [] },
  { root: "packages/shipping", contextName: "shipping", layerDirs: ["src"] },
];

const COLUMNS: ReadonlyArray<EntityDataGridColumn<DetectedPackageRow>> = [
  { id: "root", header: "Package root", cell: (row) => row.root },
  { id: "context", header: "Context name", cell: (row) => row.contextName },
  {
    id: "layers",
    header: "Layers",
    align: "end",
    cell: (row) =>
      row.layerDirs.length > 0 ? `${row.layerDirs.length} found` : "not found",
  },
];

function renderGrid(
  overrides: Partial<EntityDataGridProps<DetectedPackageRow>> = {},
) {
  const props = {
    rows: PACKAGES,
    columns: COLUMNS,
    rowKey: (row: DetectedPackageRow) => row.root,
    caption: "7 packages detected",
    ...overrides,
  } as EntityDataGridProps<DetectedPackageRow>;

  return render(<EntityDataGrid<DetectedPackageRow> {...props} />);
}

const detailFor = (row: DetectedPackageRow) => (
  <span>{`dirs for ${row.root}`}</span>
);

const expanderLabelFor = (row: DetectedPackageRow) =>
  `Layer directories for ${row.root}`;

describe("EntityDataGrid", () => {
  it("renders one body row per item", () => {
    const { container } = renderGrid();
    expect(container.querySelectorAll("tbody > tr").length).toBe(
      PACKAGES.length,
    );
  });

  it("renders every row's cells", () => {
    renderGrid();
    expect(screen.getByText("packages/orders")).toBeTruthy();
    expect(screen.getByText("packages/billing")).toBeTruthy();
    expect(screen.getByText("packages/shipping")).toBeTruthy();
  });

  it("renders the caption as a real <caption> element", () => {
    const { container } = renderGrid();
    const caption = container.querySelector("caption");
    expect(caption).toBeTruthy();
    expect(caption?.textContent).toBe("7 packages detected");
  });

  it("keeps the caption in the accessibility tree when visually hidden", () => {
    const { container } = renderGrid({
      captionAppearance: "screen-reader-only",
    });
    const caption = container.querySelector("caption");
    expect(caption?.textContent).toBe("7 packages detected");
    expect(caption?.getAttribute("class")?.includes("sr-only")).toBe(true);
  });

  it("puts scope=col on every column header", () => {
    const { container } = renderGrid();
    const headers = Array.from(container.querySelectorAll("thead th"));
    expect(headers.length).toBe(COLUMNS.length);
    for (const header of headers) {
      expect(header.getAttribute("scope")).toBe("col");
    }
  });

  it("names a header-hidden column for screen readers instead of dropping it", () => {
    const { container } = renderGrid({
      columns: [
        {
          id: "include",
          header: "Include",
          headerHidden: true,
          cell: () => "x",
        },
        ...COLUMNS,
      ],
    });
    const firstHeader = container.querySelector("thead th");
    expect(firstHeader?.textContent).toBe("Include");
    expect(firstHeader?.querySelector(".sr-only")).toBeTruthy();
  });

  it("never claims role=grid", () => {
    const { container } = renderGrid();
    expect(container.querySelector('[role="grid"]')).toBeNull();
    expect(container.querySelector('[role="gridcell"]')).toBeNull();
  });

  it("carries explicit table roles so the responsive display swap cannot strip them", () => {
    const { container } = renderGrid();
    expect(container.querySelector("table")?.getAttribute("role")).toBe(
      "table",
    );
    expect(container.querySelector("tbody")?.getAttribute("role")).toBe(
      "rowgroup",
    );
    expect(container.querySelector("tbody > tr")?.getAttribute("role")).toBe(
      "row",
    );
    expect(
      container.querySelector("tbody > tr > td")?.getAttribute("role"),
    ).toBe("cell");
  });

  it("renders the nominated column as th scope=row", () => {
    const { container } = renderGrid({ rowHeaderColumnId: "root" });
    const rowHeaders = Array.from(container.querySelectorAll("tbody th"));
    expect(rowHeaders.length).toBe(PACKAGES.length);
    expect(rowHeaders[0]?.getAttribute("scope")).toBe("row");
    expect(rowHeaders[0]?.getAttribute("role")).toBe("rowheader");
    expect(rowHeaders[0]?.textContent?.includes("packages/orders")).toBe(true);
  });

  it("renders no row headers when no column is nominated", () => {
    const { container } = renderGrid();
    expect(container.querySelectorAll("tbody th").length).toBe(0);
  });

  it("renders no expander when no expanded-row renderer is supplied", () => {
    const { container } = renderGrid();
    expect(container.querySelectorAll("tbody button").length).toBe(0);
  });

  it("renders a collapsed expander per row when a renderer is supplied", () => {
    const { container } = renderGrid({
      renderExpandedRow: detailFor,
      expandLabel: expanderLabelFor,
    });
    const expanders = Array.from(container.querySelectorAll("tbody button"));
    expect(expanders.length).toBe(PACKAGES.length);
    for (const expander of expanders) {
      expect(expander.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("points aria-controls at a detail row that already exists while collapsed", () => {
    const { container } = renderGrid({ renderExpandedRow: detailFor });
    const expander = container.querySelector("tbody button");
    const detailId = expander?.getAttribute("aria-controls") ?? "";
    expect(detailId.length > 0).toBe(true);

    const detailRow = document.getElementById(detailId);
    expect(detailRow).toBeTruthy();
    expect(detailRow?.tagName.toLowerCase()).toBe("tr");
    expect(detailRow?.hasAttribute("hidden")).toBe(true);
  });

  it("expands a row on click and reveals its detail content", () => {
    const { container } = renderGrid({
      renderExpandedRow: detailFor,
      expandLabel: expanderLabelFor,
    });
    const expander = screen.getByRole("button", {
      name: "Layer directories for packages/orders",
    });
    expect(container.textContent?.includes("dirs for packages/orders")).toBe(
      false,
    );

    fireEvent.click(expander);

    expect(expander.getAttribute("aria-expanded")).toBe("true");
    const detailRow = document.getElementById(
      expander.getAttribute("aria-controls") ?? "",
    );
    expect(detailRow?.hasAttribute("hidden")).toBe(false);
    expect(detailRow?.textContent).toBe("dirs for packages/orders");
  });

  it("collapses again on a second click", () => {
    const { container } = renderGrid({
      renderExpandedRow: detailFor,
      expandLabel: expanderLabelFor,
    });
    const expander = screen.getByRole("button", {
      name: "Layer directories for packages/orders",
    });

    fireEvent.click(expander);
    fireEvent.click(expander);

    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent?.includes("dirs for packages/orders")).toBe(
      false,
    );
  });

  it("gives each expander its own accessible name", () => {
    renderGrid({
      renderExpandedRow: detailFor,
      expandLabel: expanderLabelFor,
    });
    expect(
      screen.getByRole("button", {
        name: "Layer directories for packages/billing",
      }),
    ).toBeTruthy();
  });

  it("honours defaultExpandedRowKeys", () => {
    const { container } = renderGrid({
      renderExpandedRow: detailFor,
      defaultExpandedRowKeys: ["packages/billing"],
    });
    expect(container.textContent?.includes("dirs for packages/billing")).toBe(
      true,
    );
    expect(container.textContent?.includes("dirs for packages/orders")).toBe(
      false,
    );
  });

  it("stays controlled when expandedRowKeys is supplied", () => {
    const onExpandedChange = vi.fn();
    const { container } = renderGrid({
      renderExpandedRow: detailFor,
      expandLabel: expanderLabelFor,
      expandedRowKeys: [],
      onExpandedChange,
    });
    const expander = screen.getByRole("button", {
      name: "Layer directories for packages/orders",
    });

    fireEvent.click(expander);

    expect(onExpandedChange.mock.calls.length).toBe(1);
    expect(onExpandedChange.mock.calls[0]).toEqual(["packages/orders", true]);
    // The host owns the set, so the grid must not have opened it on its own.
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent?.includes("dirs for packages/orders")).toBe(
      false,
    );
  });

  it("renders the empty label instead of rows when there is nothing to show", () => {
    const { container } = renderGrid({ rows: [], emptyLabel: "No packages." });
    expect(container.querySelectorAll("tbody > tr").length).toBe(1);
    expect(screen.getByText("No packages.")).toBeTruthy();
  });

  it("labels each cell inside the row so the sub-md stacked card is readable", () => {
    // Below `md` the header row is display:none and each cell carries its own
    // label. jsdom loads no stylesheet, so the collapse is asserted on the
    // class contract that produces it rather than on computed layout.
    const { container } = renderGrid();
    const firstCell = container.querySelector("tbody > tr > td");
    const cellClass = firstCell?.getAttribute("class") ?? "";
    expect(cellClass.includes("block")).toBe(true);
    expect(cellClass.includes("md:table-cell")).toBe(true);

    const inCellLabel = firstCell?.querySelector("span");
    expect(inCellLabel?.textContent).toBe("Package root");
    expect(inCellLabel?.getAttribute("class")?.includes("md:hidden")).toBe(
      true,
    );

    const head = container.querySelector("thead");
    expect(head?.getAttribute("class")?.includes("hidden")).toBe(true);
    expect(head?.getAttribute("class")?.includes("md:table-header-group")).toBe(
      true,
    );
  });

  it("stacks rows as cards below md and reverts to table rows above it", () => {
    const { container } = renderGrid();
    const rowClass =
      container.querySelector("tbody > tr")?.getAttribute("class") ?? "";
    expect(rowClass.includes("block")).toBe(true);
    expect(rowClass.includes("md:table-row")).toBe(true);
    expect(rowClass.includes("rounded-lg")).toBe(true);
    expect(rowClass.includes("md:rounded-none")).toBe(true);
  });

  it("never introduces a horizontal scroll container", () => {
    const { container } = renderGrid();
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
    expect(container.querySelector(".overflow-x-scroll")).toBeNull();
    const tableClass =
      container.querySelector("table")?.getAttribute("class") ?? "";
    expect(tableClass.includes("w-full")).toBe(true);
  });

  it("applies a row variant without accepting a domain verdict prop", () => {
    const { container } = renderGrid({
      rowVariant: (row) =>
        row.layerDirs.length === 0 ? "attention" : "default",
    });
    const rows = Array.from(container.querySelectorAll("tbody > tr"));
    expect(rows[0]?.getAttribute("class")?.includes("bg-card")).toBe(true);
    expect(rows[1]?.getAttribute("class")?.includes("bg-warning/10")).toBe(
      true,
    );
  });

  it("names the table explicitly, so the name survives the display flip", () => {
    // The <caption> alone normally names a table, but this grid changes the
    // table's `display` below md -- and changing display is precisely what
    // strips table semantics. aria-labelledby makes the name independent of
    // that association.
    const { container } = renderGrid();
    const table = container.querySelector("table");
    const labelledBy = table?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const caption = container.querySelector("caption");
    expect(caption?.getAttribute("id")).toBe(labelledBy);
    expect(caption?.textContent ?? "").not.toBe("");
  });

  it("never emits colSpan=0, even with no columns", () => {
    // colSpan={0} is invalid HTML -- the attribute's minimum is 1 -- and
    // columns.length can be 0 for a caller rendering an empty grid before its
    // columns are known, which is exactly when the empty row needs a colSpan.
    const { container } = renderGrid({ rows: [], columns: [] });
    const spans = Array.from(container.querySelectorAll("[colspan]")).map(
      (el) => Number(el.getAttribute("colspan")),
    );
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) expect(span).toBeGreaterThanOrEqual(1);
  });
});
