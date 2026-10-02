import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Contract, ObservedReport, Slice } from "@hexagen/shared";
import { MiddlePanel } from "../MiddlePanel";
import type { LoadedBundle } from "../../bundle/read-bundle";

const NOW = "2026-10-01T10:00:00.000Z";
const repo = { commit: "0123456789abcdef0123456789abcdef01234567" };
const Z = "0".repeat(64);

type Edge = { from: string; to: string; specifier: string };

function observedOf(
  over: {
    packages?: { name: string; root: string }[];
    edges?: Edge[];
    unresolved?: { from: string; specifier: string; reason: string }[];
    unread?: string[];
    truncated?: boolean;
    truncReasons?: string[];
  } = {},
): ObservedReport {
  return {
    schemaVersion: "1.0.0",
    repo,
    generatedAt: NOW,
    packages: {
      collected: true,
      items: (over.packages ?? []).map((p) => ({
        ...p,
        manifestFile: `${p.root}/package.json`,
      })),
    },
    languages: { collected: true, items: [] },
    build: { collected: true, items: [] },
    generated: { collected: true, items: [] },
    dontTouch: { collected: true, items: [] },
    edges: {
      collected: true,
      unreadLanguages: over.unread ?? [],
      items: over.edges ?? [],
    },
    unresolved: { collected: true, items: over.unresolved ?? [] },
    limits: {
      truncated: over.truncated ?? false,
      reasons: over.truncReasons ?? [],
    },
  };
}

const sliceOf = (paths: string[], excludes: string[] = []): Slice => ({
  schemaVersion: "1.0.0",
  id: "slice-1",
  repo,
  paths,
  excludes,
  createdBy: "fde",
  createdAt: NOW,
});

const contractOf = (rules: Contract["rules"]): Contract => ({
  schemaVersion: "1.0.0",
  sliceId: "slice-1",
  rules,
  knownViolations: [],
});

function bundleOf(p: {
  observed?: ObservedReport | null;
  slice?: Slice | null;
  contract?: Contract | null;
  sliceText?: string;
  contractText?: string;
  grants?: { path: string; text: string }[];
}): LoadedBundle {
  const texts = new Map<string, string>();
  const sl = p.slice ?? null;
  const co = p.contract ?? null;
  if (sl) texts.set("slice.json", p.sliceText ?? JSON.stringify(sl, null, 2));
  if (co)
    texts.set("contract.json", p.contractText ?? JSON.stringify(co, null, 2));
  for (const g of p.grants ?? []) texts.set(g.path, g.text);
  return {
    index: {
      schemaVersion: "1.0.0",
      createdAt: NOW,
      sliceId: "slice-1",
      files: [],
      hmac: Z,
    },
    texts,
    observed: p.observed ?? null,
    slice: sl,
    contract: co,
    tip: null,
    grants: p.grants ?? [],
    proposals: [],
    trace: null,
    verdicts: null,
  };
}

const observedRegion = () => screen.getByTestId("observed-layer");
const proposedRegion = () => screen.getByTestId("proposed-layer");

const PKGS = [
  { name: "@acme/web-app", root: "apps/web" },
  { name: "@acme/shared.lib", root: "libs/shared" },
];
const EDGES: Edge[] = [
  {
    from: "apps/web/a.ts",
    to: "libs/shared/x.ts",
    specifier: "@acme/shared.lib",
  },
  {
    from: "apps/web/b.ts",
    to: "libs/shared/y.ts",
    specifier: "@acme/shared.lib",
  },
  { from: "apps/web/c.ts", to: "apps/web/d.ts", specifier: "./d" },
  { from: "libs/shared/z.ts", to: "apps/web/q.ts", specifier: "@acme/web-app" },
];

describe("observed layer", () => {
  it("shows packages and cross-package edges in the repo's own names", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: [
              { name: "@Ünï/ço.re", root: "core" },
              { name: "weird.name_v2", root: "w" },
            ],
            edges: [{ from: "core/a.ts", to: "w/b.ts", specifier: "weird" }],
          }),
        })}
      />,
    );
    const o = within(observedRegion());
    expect(o.getAllByText("@Ünï/ço.re").length).toBeGreaterThan(0);
    expect(o.getAllByText("weird.name_v2").length).toBeGreaterThan(0);
    const edge = o.getByTestId("package-edge");
    expect(edge.textContent).toContain("@Ünï/ço.re");
    expect(edge.textContent).toContain("weird.name_v2");
    expect(edge.textContent).toContain("1 edge");
  });

  it("does not list a same-package import as a cross-package edge", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: EDGES }),
        })}
      />,
    );
    const rows = within(observedRegion()).getAllByTestId("package-edge");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("2 edges");
  });

  it("marks unresolved imports as their own marks", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: PKGS,
            unresolved: [
              {
                from: "apps/web/a.ts",
                specifier: "ghost-pkg",
                reason: "not-found",
              },
            ],
          }),
        })}
      />,
    );
    const marks = within(observedRegion()).getAllByTestId("unresolved-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toContain("unresolved");
    expect(marks[0].textContent).toContain("ghost-pkg");
    expect(marks[0].textContent).toContain("apps/web/a.ts");
    expect(marks[0].textContent).toContain("not-found");
  });

  it("hides per-file edges until drill-down", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: EDGES }),
        })}
      />,
    );
    const o = within(observedRegion());
    expect(o.queryByText(/libs\/shared\/x\.ts/)).toBeNull();
    const expand = o.getAllByRole("button", { name: /expand/i })[0];
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(o.getByText(/libs\/shared\/x\.ts/)).toBeTruthy();
    fireEvent.click(expand);
    expect(o.queryByText(/libs\/shared\/x\.ts/)).toBeNull();
  });

  it("flags an incomplete edge list and a truncated scan", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            unread: ["go"],
            truncated: true,
            truncReasons: ["file cap reached"],
          }),
        })}
      />,
    );
    const o = within(observedRegion());
    expect(
      o.getByRole("alert", { name: /edges incomplete/i }).textContent,
    ).toContain("go");
    expect(
      o.getByRole("alert", { name: /scan truncated/i }).textContent,
    ).toContain("file cap reached");
  });

  it("raises no incompleteness flag for a complete scan", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({ observed: observedOf({ packages: PKGS }) })}
      />,
    );
    expect(within(observedRegion()).queryByRole("alert")).toBeNull();
  });

  it("says an edge section was not collected, with its reason", () => {
    const o = observedOf({ packages: PKGS });
    o.edges = { collected: false, reason: "no import pass" };
    render(<MiddlePanel bundle={bundleOf({ observed: o })} />);
    expect(
      within(observedRegion()).getByRole("alert", { name: /edges incomplete/i })
        .textContent,
    ).toContain("no import pass");
  });

  it("says 'not in this bundle' with no observed report", () => {
    render(<MiddlePanel bundle={bundleOf({ observed: null })} />);
    expect(observedRegion().textContent).toContain("not in this bundle");
  });

  it("says so for an empty observed report", () => {
    render(<MiddlePanel bundle={bundleOf({ observed: observedOf() })} />);
    expect(observedRegion().textContent).toMatch(/empty/i);
  });

  it("renders html and control characters inert", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: [{ name: `${evil}\u001b[31m`, root: "e" }],
            unresolved: [
              {
                from: "e/a.ts",
                specifier: "<script>1</script>\u0007",
                reason: "r",
              },
            ],
          }),
          grants: [{ path: "grants/0-g.json", text: `{"x":"${evil}\u0007"}` }],
        })}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(evil);
    expect(container.textContent?.length).toBeGreaterThan(0);
    // population-guard: non-empty asserted just above / by the loop over controls
    expect(container.textContent).not.toMatch(
      /[\u0000-\u0008\u000b-\u001f\u007f]/,
    );
  });
});

describe("proposed layer", () => {
  const slice = sliceOf(["apps/web/"], ["apps/web/gen/"]);
  const forbid = {
    id: "no-shared",
    kind: "forbid" as const,
    from: "apps/web/",
    to: "libs/shared/",
    severity: "error" as const,
  };

  it("shows the slice boundary and the contract rules", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: EDGES }),
          slice,
          contract: contractOf([forbid]),
        })}
      />,
    );
    const p = within(proposedRegion());
    expect(p.getAllByText("apps/web/").length).toBeGreaterThan(0);
    expect(p.getByText("apps/web/gen/")).toBeTruthy();
    const rule = p.getByTestId("contract-rule");
    expect(rule.textContent).toContain("no-shared");
    expect(rule.textContent).toContain("forbid");
    expect(rule.textContent).toContain("libs/shared/");
  });

  it("highlights a violating in-slice edge, not a legal one, and not one outside the slice", () => {
    const edges: Edge[] = [
      { from: "apps/web/a.ts", to: "libs/shared/x.ts", specifier: "bad" },
      { from: "apps/web/b.ts", to: "apps/web/e.ts", specifier: "legal" },
      {
        from: "libs/shared/z.ts",
        to: "libs/shared/w.ts",
        specifier: "outside",
      },
      {
        from: "apps/web/gen/g.ts",
        to: "libs/shared/x.ts",
        specifier: "excluded",
      },
    ];
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges }),
          slice,
          contract: contractOf([forbid]),
        })}
      />,
    );
    const rows = within(proposedRegion()).getAllByTestId("slice-edge");
    const byText = (s: string) => rows.find((r) => r.textContent?.includes(s));
    expect(byText("apps/web/a.ts")?.getAttribute("data-violation")).toBe(
      "true",
    );
    expect(byText("apps/web/a.ts")?.textContent).toContain("no-shared");
    expect(byText("apps/web/b.ts")?.getAttribute("data-violation")).toBe(
      "false",
    );
    expect(byText("libs/shared/z.ts")).toBeUndefined();
    expect(byText("apps/web/gen/g.ts")).toBeUndefined();
    expect(within(proposedRegion()).getAllByTestId("violation")).toHaveLength(
      1,
    );
  });

  it("judges allow-only by the contract semantics", () => {
    const edges: Edge[] = [
      { from: "apps/web/a.ts", to: "libs/shared/x.ts", specifier: "ok" },
      { from: "apps/web/b.ts", to: "apps/web/c.ts", specifier: "same" },
      { from: "apps/web/d.ts", to: "other/o.ts", specifier: "bad" },
    ];
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges }),
          slice,
          contract: contractOf([
            {
              id: "only-shared",
              kind: "allow-only",
              from: "apps/web/",
              to: "libs/shared/",
              severity: "warn",
            },
          ]),
        })}
      />,
    );
    const v = within(proposedRegion()).getAllByTestId("violation");
    expect(v).toHaveLength(1);
    expect(v[0].closest("[data-testid=slice-edge]")?.textContent).toContain(
      "apps/web/d.ts",
    );
  });

  it("flags an in-slice unresolved import as a violation", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: PKGS,
            unresolved: [
              { from: "apps/web/a.ts", specifier: "ghost", reason: "r" },
              { from: "libs/shared/a.ts", specifier: "far", reason: "r" },
            ],
          }),
          slice,
          contract: contractOf([]),
        })}
      />,
    );
    const rows = within(proposedRegion()).getAllByTestId("slice-unresolved");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("ghost");
    expect(within(proposedRegion()).getAllByTestId("violation")).toHaveLength(
      1,
    );
  });

  it("marks in-slice edges in the observed drill-down and no others", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: EDGES }),
          slice,
          contract: contractOf([]),
        })}
      />,
    );
    const o = within(observedRegion());
    for (const b of o.getAllByRole("button", { name: /expand/i }))
      fireEvent.click(b);
    const rows = o.getAllByTestId("file-edge");
    const inSlice = rows
      .filter((r) => r.getAttribute("data-in-slice") === "true")
      .map((r) => r.textContent)
      .join("|");
    expect(inSlice).toContain("apps/web/a.ts");
    expect(inSlice.length).toBeGreaterThan(0);
    expect(inSlice).not.toContain("libs/shared/z.ts");
  });

  it("shows the observed layer alone when slice and contract are missing", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({ observed: observedOf({ packages: PKGS }) })}
      />,
    );
    expect(observedRegion()).toBeTruthy();
    expect(proposedRegion().textContent).toMatch(/proposed layer is missing/i);
    expect(screen.queryByTestId("slice-edge")).toBeNull();
  });

  it("with a slice but no contract, shows the slice and says the contract is missing", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({ observed: observedOf({ packages: PKGS }), slice })}
      />,
    );
    expect(proposedRegion().textContent).toContain("apps/web/");
    expect(proposedRegion().textContent).toMatch(
      /contract.*missing|missing.*contract/i,
    );
  });

  it("lets the proposed layer be hidden but offers no way to hide the observed one", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: EDGES }),
          slice,
          contract: contractOf([forbid]),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /hide proposed/i }));
    expect(screen.queryByTestId("proposed-layer-body")).toBeNull();
    expect(observedRegion()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /show proposed/i }));
    expect(screen.getByTestId("proposed-layer-body")).toBeTruthy();
  });

  it("no button or toggle, clicked in any order, removes the observed layer", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: EDGES }),
          slice,
          contract: contractOf([forbid]),
          grants: [{ path: "grants/0-g.json", text: "{}" }],
        })}
      />,
    );
    const controls = () => [
      ...screen.getAllByRole("button"),
      ...screen.queryAllByRole("checkbox"),
      ...screen.queryAllByRole("switch"),
      ...screen.queryAllByRole("tab"),
      ...screen.queryAllByRole("radio"),
    ];
    expect(controls().length).toBeGreaterThan(2);
    for (const c of controls()) {
      // population-guard: non-empty asserted just above / by the loop over controls
      expect(c.textContent ?? "").not.toMatch(/observed/i);
      // population-guard: non-empty asserted just above / by the loop over controls
      expect(c.getAttribute("aria-label") ?? "").not.toMatch(/observed/i);
    }
    for (let round = 0; round < 2; round++) {
      for (const c of controls()) {
        fireEvent.click(c);
        expect(screen.getByTestId("observed-layer")).toBeTruthy();
        expect(
          within(observedRegion()).getAllByText("@acme/web-app").length,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("code panel", () => {
  const slice = sliceOf(["apps/web/"]);
  const contract = contractOf([]);
  // key order and whitespace differ from JSON.stringify's output
  const sliceText = `{\n\t"paths": [ "apps/web/" ],   \n  "id":"slice-1",\n"schemaVersion" : "1.0.0","excludes":[],"repo":{"commit":"${repo.commit}"},"createdBy":"fde","createdAt":"${NOW}"}`;
  const contractText = `{"sliceId":"slice-1","schemaVersion":"1.0.0",\n\n   "knownViolations":[],"rules":[]}\n\n`;
  const grantText = `{ "tools" : ["read_file"],\t"id":"g1",\n "mode":"propose"   }`;

  function setup() {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS }),
          slice,
          contract,
          sliceText,
          contractText,
          grants: [{ path: "grants/0-g1.json", text: grantText }],
        })}
      />,
    );
  }
  const shown = () => screen.getByTestId("code-text");

  it("shows slice, contract and grant text exactly as the bundle holds it", () => {
    setup();
    const code = screen.getByTestId("code-panel");
    fireEvent.click(within(code).getByRole("button", { name: "slice.json" }));
    expect(shown().textContent).toBe(sliceText);
    fireEvent.click(
      within(code).getByRole("button", { name: "contract.json" }),
    );
    expect(shown().textContent).toBe(contractText);
    fireEvent.click(
      within(code).getByRole("button", { name: "grants/0-g1.json" }),
    );
    expect(shown().textContent).toBe(grantText);
    expect(JSON.stringify(JSON.parse(grantText))).not.toBe(grantText);
  });

  it("renders the text in a plain pre with no highlighting markup", () => {
    setup();
    const pre = shown();
    expect(pre.tagName).toBe("PRE");
    expect(pre.children).toHaveLength(0);
  });

  it("offers each file and nothing the bundle lacks", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf(),
          slice,
          sliceText,
          grants: [],
        })}
      />,
    );
    const code = screen.getByTestId("code-panel");
    expect(
      within(code).getByRole("button", { name: "slice.json" }),
    ).toBeTruthy();
    expect(
      within(code).queryByRole("button", { name: "contract.json" }),
    ).toBeNull();
  });

  it("strips control characters through cleanText", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf(),
          grants: [
            { path: "grants/0-g.json", text: "a\u001b[31mred\u0007b\tc\n" },
          ],
        })}
      />,
    );
    expect(shown().textContent).toBe("ared" + "b\tc\n");
  });
});

describe("no invented vocabulary", () => {
  const FIXED = new Set(
    [
      "observed",
      "proposed",
      "slice",
      "contract",
      "unresolved",
      "edge",
      "edges",
      "package",
      "packages",
      "violation",
      "in slice",
      "excludes",
      "code",
      "forbid",
      "allow-only",
    ].map((s) => s.toLowerCase()),
  );

  it("every badge and heading is a fixed UI word or comes from observed.json", () => {
    const names = ["zeta-unit", "q9.kernel", "@odd/theme"];
    const observed = observedOf({
      packages: [
        { name: names[0], root: "zu" },
        { name: names[1], root: "qk" },
        { name: names[2], root: "ot" },
      ],
      edges: [{ from: "zu/a.ts", to: "qk/b.ts", specifier: "q" }],
      unresolved: [{ from: "zu/a.ts", specifier: "nope", reason: "not-found" }],
      unread: ["go"],
      truncated: true,
      truncReasons: ["cap"],
    });
    const { container } = render(
      <MiddlePanel
        bundle={bundleOf({
          observed,
          slice: sliceOf(["zu/"]),
          contract: contractOf([
            {
              id: "r1",
              kind: "forbid",
              from: "zu/",
              to: "qk/",
              severity: "error",
            },
          ]),
          grants: [{ path: "grants/0-g.json", text: "{}" }],
        })}
      />,
    );
    for (const b of container.querySelectorAll("button")) fireEvent.click(b);
    // the proposed layer was hidden by the click above: show it again
    const show = screen.queryByRole("button", { name: /show proposed/i });
    if (show) fireEvent.click(show);
    for (const b of container.querySelectorAll("button[aria-expanded=false]"))
      fireEvent.click(b);
    const corpus = JSON.stringify(observed);
    const labels = [
      ...container.querySelectorAll("[data-badge], h2, h3, h4, th"),
    ].map((e) => (e.textContent ?? "").trim());
    expect(labels.length).toBeGreaterThan(8);
    for (const label of labels) {
      const ok =
        FIXED.has(label.toLowerCase()) ||
        corpus.includes(label) ||
        /^\d+ (edge|edges|package|packages)$/.test(label);
      expect(ok, `label "${label}" is neither fixed nor in observed.json`).toBe(
        true,
      );
    }
    for (const word of [
      "domain",
      "adapter",
      "port",
      "application",
      "infrastructure",
    ]) {
      // population-guard: non-empty asserted just above / by the loop over controls
      expect(container.textContent).not.toMatch(
        new RegExp(`\\b${word}\\b`, "i"),
      );
    }
  });
});
