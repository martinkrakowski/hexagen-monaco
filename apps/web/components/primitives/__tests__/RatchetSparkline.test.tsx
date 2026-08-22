/**
 * RatchetSparkline (F-31).
 *
 * The geometry is asserted through `planRatchetSparkline`, which is pure, so
 * the "what does it refuse to draw?" question is answered without a DOM. What
 * the rendering tests add is only what the DOM contributes: that the refusals
 * really produce no `<svg>`, and that the text equivalent carries every value
 * — including the ones that are missing.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
  RatchetSparkline,
  SPARKLINE_VIEW_HEIGHT,
  SPARKLINE_VIEW_WIDTH,
  planRatchetSparkline,
  type RatchetSparklinePoint,
} from "../RatchetSparkline";

// jest-dom is a dependency but apps/web/vitest.setup.ts never imports it, so
// toBeInTheDocument / toHaveAttribute are UNREGISTERED. Assertions below use
// toBeTruthy() / toBeNull() / getAttribute() instead.

function point(
  id: string,
  value: number | null,
  note?: string,
): RatchetSparklinePoint {
  return { id, label: `scan ${id}`, value, note };
}

const FALLING: RatchetSparklinePoint[] = [
  point("a", 41),
  point("b", 33),
  point("c", 20),
  point("d", 7),
];

describe("planRatchetSparkline", () => {
  it("refuses to plan anything for an empty series", () => {
    expect(planRatchetSparkline([])).toEqual({ kind: "empty" });
  });

  it("refuses a chart for a single measured point", () => {
    // The whole reason this component exists in a packet with a constraint
    // about fabricated data: one sample drawn as a line is a flat line, and a
    // flat line is a claim about stability that one observation cannot make.
    expect(planRatchetSparkline([point("a", 7)])).toEqual({
      kind: "insufficient",
      measuredCount: 1,
      totalCount: 1,
    });
  });

  it("refuses a chart when every point is unmeasured, however many there are", () => {
    const plan = planRatchetSparkline([
      point("a", null, "scan could not run"),
      point("b", null, "scan could not run"),
      point("c", null, "scan could not run"),
    ]);
    expect(plan).toEqual({
      kind: "insufficient",
      measuredCount: 0,
      totalCount: 3,
    });
  });

  it("treats NaN and Infinity as unmeasured rather than plotting them", () => {
    // These cannot come from the type, they come from a parsed payload. A
    // single NaN would poison min/max and blank the entire chart.
    const plan = planRatchetSparkline([
      point("a", Number.NaN),
      point("b", 10),
      point("c", Number.POSITIVE_INFINITY),
    ]);
    expect(plan.kind).toBe("insufficient");
    expect(plan.kind === "insufficient" && plan.measuredCount).toBe(1);
  });

  it("plots a falling series as one polyline inside the viewBox", () => {
    const plan = planRatchetSparkline(FALLING);
    expect(plan.kind).toBe("chart");
    if (plan.kind !== "chart") return;

    expect(plan.polylines).toHaveLength(1);
    expect(plan.gapX).toEqual([]);
    expect(plan.dots).toEqual([]);

    const vertices = plan.polylines[0]
      .split(" ")
      .map((pair) => pair.split(",").map(Number));
    expect(vertices).toHaveLength(4);
    for (const [x, y] of vertices) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(SPARKLINE_VIEW_WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(SPARKLINE_VIEW_HEIGHT);
    }
    // Lower is better, so a falling series descends on the page.
    expect(vertices[0][1]).toBeLessThan(vertices[3][1]);
    // x is evenly spaced by scan ORDER, not by elapsed time.
    expect(vertices[1][0] - vertices[0][0]).toBeCloseTo(
      vertices[3][0] - vertices[2][0],
      5,
    );
  });

  it("draws a flat series at mid height rather than at an edge", () => {
    const plan = planRatchetSparkline([point("a", 12), point("b", 12)]);
    expect(plan.kind).toBe("chart");
    if (plan.kind !== "chart") return;
    const ys = plan.polylines[0]
      .split(" ")
      .map((pair) => Number(pair.split(",")[1]));
    expect(ys).toEqual([SPARKLINE_VIEW_HEIGHT / 2, SPARKLINE_VIEW_HEIGHT / 2]);
  });

  it("breaks the line at an unmeasured scan instead of drawing across it", () => {
    // THE defect this component exists to prevent: a scan that could not run
    // records zero findings, and joining the neighbours across it draws an
    // improvement that never happened.
    const plan = planRatchetSparkline([
      point("a", 40),
      point("b", 30),
      point("c", null, "scan could not run"),
      point("d", 10),
      point("e", 8),
    ]);
    expect(plan.kind).toBe("chart");
    if (plan.kind !== "chart") return;

    expect(plan.polylines).toHaveLength(2);
    expect(plan.gapX).toHaveLength(1);
    // The gap keeps its slot on the axis: it sits strictly between the two runs.
    const firstRunEnd = Number(plan.polylines[0].split(" ")[1].split(",")[0]);
    const secondRunStart = Number(
      plan.polylines[1].split(" ")[0].split(",")[0],
    );
    expect(plan.gapX[0]).toBeGreaterThan(firstRunEnd);
    expect(plan.gapX[0]).toBeLessThan(secondRunStart);
  });

  it("renders an isolated measured point as a dot, not an invisible polyline", () => {
    const plan = planRatchetSparkline([
      point("a", 40),
      point("b", null),
      point("c", 10),
      point("d", null),
      point("e", 30),
    ]);
    expect(plan.kind).toBe("chart");
    if (plan.kind !== "chart") return;
    expect(plan.polylines).toEqual([]);
    expect(plan.dots).toHaveLength(3);
    expect(plan.gapX).toHaveLength(2);
  });

  it("anchors the you-are-here marker on the newest MEASURED point", () => {
    const plan = planRatchetSparkline([
      point("a", 40),
      point("b", 10),
      point("c", null, "scan could not run"),
    ]);
    expect(plan.kind).toBe("chart");
    if (plan.kind !== "chart") return;
    const lastPlotted = plan.polylines[0].split(" ")[1];
    expect(`${plan.lastVertex.x},${plan.lastVertex.y}`).toBe(lastPlotted);
  });
});

describe("RatchetSparkline", () => {
  it("draws no chart at all for an empty series", () => {
    render(<RatchetSparkline points={[]} label="Findings by scan" />);
    expect(screen.queryByTestId("ratchet-sparkline")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/no scans recorded yet/i)).toBeTruthy();
  });

  it("draws no chart for one measured point and shows the table instead", () => {
    render(
      <RatchetSparkline points={[point("a", 7)]} label="Findings by scan" />,
    );
    expect(screen.queryByTestId("ratchet-sparkline")).toBeNull();
    expect(screen.getByText(/a trend needs at least two/i)).toBeTruthy();

    // The single measurement is still shown -- refusing the chart must not
    // mean refusing the number.
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("rowheader", { name: "scan a" }),
    ).toBeTruthy();
    expect(within(table).getByText("7")).toBeTruthy();
  });

  it("titles the visible table with a real caption, and never doubles the name", () => {
    // Visible branch: the caption names the table for everyone. The aria-label
    // is deliberately absent here, or the title would be announced twice --
    // once as the table's name and again as its first content.
    const { container } = render(
      <RatchetSparkline points={[point("a", 7)]} label="Findings by scan" />,
    );
    const table = screen.getByRole("table");
    expect(table.getAttribute("aria-label")).toBeNull();
    expect(container.querySelector("caption")?.textContent).toBe(
      "Findings by scan",
    );
  });

  it("names the screen-reader-only table without repeating it as a caption", () => {
    const { container } = render(
      <RatchetSparkline points={FALLING} label="Findings by scan" />,
    );
    expect(screen.getByRole("table").getAttribute("aria-label")).toBe(
      "Findings by scan",
    );
    expect(container.querySelector("caption")).toBeNull();
  });

  it("lets the host replace the insufficient-data sentence", () => {
    render(
      <RatchetSparkline
        points={[point("a", 7)]}
        label="Findings by scan"
        insufficientLabel="This is the first scan of acme/checkout."
      />,
    );
    expect(
      screen.getByText("This is the first scan of acme/checkout."),
    ).toBeTruthy();
  });

  it("draws a chart for two or more measured points", () => {
    render(<RatchetSparkline points={FALLING} label="Findings by scan" />);
    const svg = screen.getByTestId("ratchet-sparkline");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("viewBox")).toBe(
      `0 0 ${SPARKLINE_VIEW_WIDTH} ${SPARKLINE_VIEW_HEIGHT}`,
    );
  });

  it("keeps the chart out of the accessibility tree and the table in it", () => {
    // The accessibility decision, asserted: the svg is aria-hidden and the
    // <table> -- named by its caption -- is what a screen reader reaches.
    render(<RatchetSparkline points={FALLING} label="Findings by scan" />);
    const table = screen.getByRole("table", { name: "Findings by scan" });
    expect(table).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(5); // header + 4
    expect(
      within(table).getByRole("columnheader", { name: "Findings" }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("rowheader", { name: "scan d" }),
    ).toBeTruthy();
  });

  it("spells out a missing reading in the table rather than leaving it blank", () => {
    render(
      <RatchetSparkline
        points={[
          point("a", 40),
          point("b", null, "scan could not run"),
          point("c", 10),
        ]}
        label="Findings by scan"
      />,
    );
    const table = screen.getByRole("table");
    const row = within(table).getByRole("rowheader", { name: "scan b" })
      .parentElement as HTMLElement;
    expect(row.textContent).toContain("scan could not run");
    // And emphatically not a zero -- that is the false green.
    expect(within(row).queryByText("0")).toBeNull();
  });

  it("falls back to a stated reason when an unmeasured point carries no note", () => {
    render(
      <RatchetSparkline
        points={[point("a", 40), point("b", null), point("c", 10)]}
        label="Findings by scan"
      />,
    );
    expect(screen.getByText("not measured")).toBeTruthy();
  });

  it("shows the host's summary sentence to everyone, not only to a screen reader", () => {
    render(
      <RatchetSparkline
        points={FALLING}
        label="Findings by scan"
        summary="Down from 41 to 7 across the last 4 scans."
      />,
    );
    const caption = screen.getByText(
      "Down from 41 to 7 across the last 4 scans.",
    );
    expect(caption.tagName.toLowerCase()).toBe("figcaption");
    expect(caption.getAttribute("class")?.includes("sr-only")).toBe(false);
  });
});
