import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountPills } from "../CountPills";

// Assertions use toBeTruthy()/getAttribute()/toBeNull() rather than jest-dom
// matchers: @testing-library/jest-dom is a dependency but apps/web's
// vitest.setup.ts never imports it, so toBeInTheDocument/toHaveAttribute are
// UNREGISTERED and would throw "is not a function" at call time.

// The S6 report dashboard's four counts. `baselined` deliberately omits a tone
// so the neutral default is exercised by the real fixture.
const FINDING_COUNTS = [
  { id: "fresh", label: "fresh", count: 7, tone: "warning" as const },
  { id: "baselined", label: "baselined", count: 27 },
  { id: "stale", label: "stale", count: 2, tone: "positive" as const },
  { id: "expired", label: "expired", count: 1, tone: "danger" as const },
];

// The S5 sticky footer: "27 baselined - 7 fresh".
const FOOTER_COUNTS = [
  { id: "baselined", label: "baselined", count: 27 },
  { id: "fresh", label: "fresh", count: 7, tone: "warning" as const },
];

describe("CountPills", () => {
  it("renders one accessible list item per count", () => {
    render(<CountPills pills={FINDING_COUNTS} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("reads each count and its label as one contiguous run", () => {
    // This is the aria-live contract: the S5 footer updates live, and a bag of
    // numbers followed by adrift labels is unusable when read aloud.
    render(<CountPills pills={FOOTER_COUNTS} appearance="inline" />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "27 baselined",
      "7 fresh, needs attention",
    ]);
  });

  it("names the row when the host supplies a label", () => {
    render(<CountPills pills={FINDING_COUNTS} label="Finding counts" />);
    expect(screen.getByRole("list", { name: "Finding counts" })).toBeTruthy();
  });

  it("marks severity on each item so a host can key off it", () => {
    render(<CountPills pills={FINDING_COUNTS} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-tone"))).toEqual([
      "warning",
      "neutral",
      "positive",
      "danger",
    ]);
  });

  it("defaults an untoned count to neutral with no severity wording", () => {
    render(<CountPills pills={FINDING_COUNTS} />);
    const baselined = screen.getAllByRole("listitem")[1];
    expect(baselined.getAttribute("data-tone")).toBe("neutral");
    expect(baselined.textContent).toBe("27 baselined");
  });

  it("pairs every severity with its own glyph, so colour is never the only cue", () => {
    render(<CountPills pills={FINDING_COUNTS} />);
    const items = screen.getAllByRole("listitem");
    // Compare the rendered SVG bodies rather than class names: four distinct
    // silhouettes is the WCAG 1.4.1 requirement, and a test that only counted
    // <svg> elements would pass on four recolourings of the same circle.
    const glyphs = items.map((item) => item.querySelector("svg")?.innerHTML);
    expect(glyphs.filter(Boolean)).toHaveLength(4);
    expect(new Set(glyphs).size).toBe(4);
  });

  it("hides the decorative glyph from assistive tech", () => {
    const { container } = render(<CountPills pills={FINDING_COUNTS} />);
    const svgs = Array.from(container.querySelectorAll("svg"));
    expect(svgs).toHaveLength(4);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("spells out the actionable severities for screen readers", () => {
    render(<CountPills pills={FINDING_COUNTS} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("needs attention");
    expect(items[3].textContent).toContain("action required");
    // Neutral and positive stay quiet -- "fine" on every count is noise in a
    // live region, not information.
    expect(items[1].textContent).not.toContain("needs attention");
    expect(items[2].textContent).not.toContain("action required");
  });

  it("separates inline counts with a divider that assistive tech never sees", () => {
    const { container } = render(
      <CountPills pills={FOOTER_COUNTS} appearance="inline" />,
    );
    const allItems = Array.from(container.querySelectorAll("li"));
    expect(allItems).toHaveLength(3);
    const hidden = allItems.filter(
      (item) => item.getAttribute("aria-hidden") === "true",
    );
    expect(hidden).toHaveLength(1);
    // Excluded from the accessible tree, so the live region never says "dot".
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders no dividers in the pill appearance", () => {
    const { container } = render(<CountPills pills={FINDING_COUNTS} />);
    expect(container.querySelectorAll("li")).toHaveLength(4);
    expect(container.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(
      0,
    );
  });

  it("emits exactly one background class per pill", () => {
    // The reason this is not a Badge with a className override: Badge joins its
    // variant classes and the caller's className without tailwind-merge, so an
    // override leaves two competing bg-* classes and lets stylesheet order pick
    // the winner. The compound variants here must never produce that.
    render(<CountPills pills={FINDING_COUNTS} />);
    for (const item of screen.getAllByRole("listitem")) {
      const backgrounds = (item.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((token) => token.startsWith("bg-"));
      expect(backgrounds).toHaveLength(1);
    }
  });

  it("paints severity with the semantic palette, never the brand accent", () => {
    render(<CountPills pills={FINDING_COUNTS} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0].getAttribute("class")).toContain("bg-warning");
    expect(items[1].getAttribute("class")).toContain("bg-secondary");
    expect(items[2].getAttribute("class")).toContain("bg-success");
    expect(items[3].getAttribute("class")).toContain("bg-destructive");
    for (const item of items) {
      expect(item.getAttribute("class")).not.toContain("bg-primary");
    }
  });

  it("drops the pill chrome in the inline appearance", () => {
    render(<CountPills pills={FOOTER_COUNTS} appearance="inline" />);
    for (const item of screen.getAllByRole("listitem")) {
      expect(item.getAttribute("class")).not.toContain("rounded-full");
    }
  });

  it("appends the host's layout classes to the row", () => {
    const { container } = render(
      <CountPills pills={FINDING_COUNTS} className="justify-end" />,
    );
    const row = container.firstElementChild;
    expect(row?.getAttribute("class")).toContain("justify-end");
    expect(row?.getAttribute("class")).toContain("flex");
  });

  it("renders an empty row rather than throwing when there is nothing to count", () => {
    const { container } = render(<CountPills pills={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector("ul")).toBeTruthy();
  });
});
