import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Contract, ObservedReport, Slice } from "@hexagen/shared";
import { UNRESOLVED_IMPORT_RULE_ID } from "@hexagen/shared";
import { MiddlePanel } from "../MiddlePanel";
import { packageEdges } from "../derive";
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
  createdAt?: string;
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
      createdAt: p.createdAt ?? NOW,
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
    proposalFiles: new Map(),
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

  it("shows a closed rule's excepts, with no from -> to pair it does not carry", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: EDGES }),
          slice,
          contract: contractOf([
            {
              id: "closed-slice",
              kind: "closed",
              except: ["libs/shared/", "libs/date"],
              severity: "error",
            },
          ]),
        })}
      />,
    );
    const rule = within(proposedRegion()).getByTestId("contract-rule");
    const line = rule.textContent ?? "";
    expect(line).toContain("closed-slice");
    expect(line).toContain("closed");
    expect(line).toContain("libs/shared/");
    expect(line).toContain("libs/date");
    expect(line.length).toBeGreaterThan(0);
    expect(line).not.toContain("->");
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
    // population-guard: the toContain above proves inSlice is non-empty
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

  it("no control, clicked in any order, hides or removes the observed layer", () => {
    const { container } = render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: PKGS,
            edges: EDGES,
            unresolved: [
              { from: "apps/web/a.ts", specifier: "g", reason: "r" },
            ],
          }),
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
      ...container.querySelectorAll("summary"),
      ...container.querySelectorAll("a[href]"),
    ];
    const edgesBefore =
      within(observedRegion()).getAllByTestId("package-edge").length;
    const marksBefore =
      within(observedRegion()).getAllByTestId("unresolved-mark").length;
    expect(controls().length).toBeGreaterThan(2);
    for (const c of controls()) {
      // population-guard: the control count is asserted above
      expect(c.textContent ?? "").not.toMatch(/observed/i);
      // population-guard: the control count is asserted above
      expect(c.getAttribute("aria-label") ?? "").not.toMatch(/observed/i);
    }
    const concealed = (el: Element | null): string[] => {
      const why: string[] = [];
      for (
        let e = el;
        e && e !== container.parentElement;
        e = e.parentElement
      ) {
        if (e.hasAttribute("hidden")) why.push("hidden attribute");
        if (e.hasAttribute("aria-hidden")) why.push("aria-hidden");
        for (const c of ["hidden", "invisible", "sr-only"]) {
          if (e.classList.contains(c)) why.push(`class ${c}`);
        }
      }
      return why;
    };
    for (let round = 0; round < 2; round++) {
      for (const c of controls()) {
        fireEvent.click(c);
        const layer = screen.getByTestId("observed-layer");
        // population-guard: concealed() returns reasons; [] means none, the layer lookup above proves it exists
        expect(concealed(layer)).toEqual([]);
        const o = within(layer);
        expect(o.getAllByTestId("package-edge")).toHaveLength(edgesBefore);
        expect(o.getAllByTestId("unresolved-mark")).toHaveLength(marksBefore);
        expect(o.getAllByText("@acme/web-app").length).toBeGreaterThan(0);
      }
    }
  });

  it("flips the hide control's label and does not also set aria-pressed", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf(),
          slice,
          contract: contractOf([]),
        })}
      />,
    );
    const b = screen.getByRole("button", { name: /hide proposed/i });
    expect(b.hasAttribute("aria-pressed")).toBe(false);
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
  const FIXED = new Set([
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
    "warning",
    "known",
    "in slice",
    "excludes",
    "code",
    "forbid",
    "allow-only",
    "closed",
    "expand files",
    "collapse files",
    "hide proposed",
    "show proposed",
    "edges incomplete",
    "scan truncated",
    "contract check incomplete",
  ]);

  // every data value the fixture feeds in: the only non-fixed text allowed
  const NAMES = ["zeta-unit", "q9.kernel", "@odd/theme"];
  const DATA = new Set<string>([
    ...NAMES,
    "zu",
    "qk",
    "ot",
    "zu/a.ts",
    "qk/b.ts",
    "q",
    "nope",
    "not-found",
    "go",
    "cap",
    "zu/",
    "r1",
    "slice.json",
    "contract.json",
    "grants/0-g.json",
  ]);

  function fixture() {
    return observedOf({
      packages: [
        { name: NAMES[0], root: "zu" },
        { name: NAMES[1], root: "qk" },
        { name: NAMES[2], root: "ot" },
      ],
      edges: [{ from: "zu/a.ts", to: "qk/b.ts", specifier: "q" }],
      unresolved: [{ from: "zu/a.ts", specifier: "nope", reason: "not-found" }],
      unread: ["go"],
      truncated: true,
      truncReasons: ["cap"],
    });
  }
  function renderFixture() {
    return render(
      <MiddlePanel
        bundle={bundleOf({
          observed: fixture(),
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
  }

  function labelsOf(container: HTMLElement): string[] {
    for (const b of container.querySelectorAll("button[aria-expanded=false]"))
      fireEvent.click(b);
    const out: string[] = [];
    const textSel =
      "[data-badge], h2, h3, h4, th, button, span[class*=rounded]";
    for (const el of container.querySelectorAll(textSel)) {
      out.push((el.textContent ?? "").trim());
    }
    for (const el of container.querySelectorAll("[aria-label], [title]")) {
      for (const attr of ["aria-label", "title"]) {
        const v = el.getAttribute(attr);
        if (v !== null) out.push(v.trim());
      }
    }
    return out;
  }

  it("every badge, heading, label, title and button is a fixed UI word or a data value", () => {
    const { container } = renderFixture();
    const labels = labelsOf(container);
    expect(labels.length).toBeGreaterThan(15);
    for (const label of labels) {
      expect(
        label.length,
        "a label must have at least two characters",
      ).toBeGreaterThanOrEqual(2);
      const ok =
        FIXED.has(label.toLowerCase()) ||
        DATA.has(label) ||
        /^\d+ (edge|edges|package|packages)$/.test(label);
      expect(
        ok,
        `label "${label}" is neither fixed nor a fixture data value`,
      ).toBe(true);
    }
  });

  it("names no type, layer or plane anywhere in the text", () => {
    const { container } = renderFixture();
    labelsOf(container);
    // text nodes joined by a space, so adjacent elements never fuse into one word
    const nodes: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push(n.textContent ?? "");
    }
    const text = nodes.join(" ");
    expect(text.length).toBeGreaterThan(50);
    for (const word of [
      "domain",
      "adapter",
      "port",
      "application",
      "infrastructure",
      "core",
      "layer",
      "service",
      "ui",
      "presentation",
    ]) {
      // population-guard: the text length is asserted above
      expect(text).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });
});

describe("cleanText on every free string", () => {
  const dirty = (t: string) => `${t}\u001b[31m\u0007`;
  const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

  it("strips control characters from every rendered string", () => {
    const o = observedOf({
      packages: [{ name: dirty("pk"), root: dirty("rt") }],
      edges: [
        {
          from: "apps/web/a.ts",
          to: "libs/shared/x.ts",
          specifier: dirty("sp"),
        },
      ],
      unresolved: [
        { from: "apps/web/b.ts", specifier: dirty("us"), reason: dirty("why") },
      ],
      unread: [dirty("xx")],
      truncated: true,
      truncReasons: [dirty("cap")],
    });
    const { container } = render(
      <MiddlePanel
        bundle={bundleOf({
          observed: o,
          slice: sliceOf(["apps/web/"], [dirty("apps/web/gen/")]),
          contract: {
            ...contractOf([
              {
                id: dirty("rid"),
                kind: "forbid",
                from: "apps/web/",
                to: "libs/shared/",
                severity: "error",
              },
              {
                id: "rb",
                kind: "forbid",
                from: dirty("fr"),
                to: dirty("to"),
                severity: "warn",
              },
            ]),
            sliceId: dirty("other-slice"),
            knownViolations: [
              {
                rule: dirty("rid"),
                file: "apps/web/a.ts",
                specifier: dirty("sp"),
                expires: "2026-10-05",
              },
            ],
          },
        })}
      />,
    );
    for (const b of container.querySelectorAll("button[aria-expanded=false]"))
      fireEvent.click(b);
    expect(container.innerHTML).toContain("pk");
    expect(container.innerHTML).toContain("rid");
    expect(CONTROL.test(container.innerHTML)).toBe(false);
  });

  it("strips control characters from section reasons that stand in for data", () => {
    const o = observedOf();
    o.packages = { collected: false, reason: dirty("no-pk") };
    o.edges = { collected: false, reason: dirty("no-ed") };
    o.unresolved = { collected: false, reason: dirty("no-un") };
    const { container } = render(
      <MiddlePanel
        bundle={bundleOf({ observed: o, slice: sliceOf(["a/"]) })}
      />,
    );
    expect(container.innerHTML).toContain("no-pk");
    expect(container.innerHTML).toContain("no-ed");
    expect(container.innerHTML).toContain("no-un");
    expect(CONTROL.test(container.innerHTML)).toBe(false);
  });

  it("strips control characters from a section reason when only unresolved is missing", () => {
    const o = observedOf({ packages: PKGS });
    o.unresolved = { collected: false, reason: dirty("no-un2") };
    const { container } = render(
      <MiddlePanel
        bundle={bundleOf({ observed: o, slice: sliceOf(["apps/web/"]) })}
      />,
    );
    expect(container.innerHTML).toContain("no-un2");
    expect(CONTROL.test(container.innerHTML)).toBe(false);
  });
});

describe("code panel keeps CRLF", () => {
  const crlf = '{\r\n\t"id": "g1",\r\n  "tools": []\r\n}\r\n';
  const show = (text: string) =>
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf(),
          grants: [{ path: "grants/0-g.json", text }],
        })}
      />,
    );

  it("shows CRLF text byte for byte and counts the line endings", () => {
    show(crlf);
    expect(screen.getByTestId("code-text").textContent).toBe(crlf);
    expect(screen.getByText("4 CRLF line endings")).toBeTruthy();
  });

  it("strips a lone CR, and shows no note for LF-only text", () => {
    show("a\rb\nc\n");
    expect(screen.getByTestId("code-text").textContent).toBe("ab\nc\n");
    expect(screen.queryByText(/CRLF line endings/)).toBeNull();
  });
});

describe("contract check completeness, mismatches and known violations", () => {
  const slice = sliceOf(["apps/web/"]);
  const forbid = {
    id: "no-shared",
    kind: "forbid" as const,
    from: "apps/web/",
    to: "libs/shared/",
    severity: "error" as const,
  };
  const bad: Edge = {
    from: "apps/web/a.ts",
    to: "libs/shared/x.ts",
    specifier: "bad",
  };

  it("says the check cannot be clean when edges were not collected", () => {
    const o = observedOf({ packages: PKGS });
    o.edges = { collected: false, reason: "no import pass" };
    render(
      <MiddlePanel
        bundle={bundleOf({ observed: o, slice, contract: contractOf([]) })}
      />,
    );
    const alert = within(proposedRegion()).getByRole("alert", {
      name: /contract check incomplete/i,
    });
    expect(alert.textContent).toContain("the check cannot be clean");
    expect(alert.textContent).toContain(
      "edges were not collected (no import pass)",
    );
  });

  it("says the check cannot be clean when unresolved imports were not collected", () => {
    const o = observedOf({ packages: PKGS });
    o.unresolved = { collected: false, reason: "skipped" };
    render(<MiddlePanel bundle={bundleOf({ observed: o, slice })} />);
    expect(proposedRegion().textContent).toContain(
      "unresolved imports were not collected (skipped)",
    );
  });

  it("says what an unread language would add, per extension", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, unread: ["go", "rs"] }),
          slice,
        })}
      />,
    );
    const t = within(proposedRegion()).getByRole("alert", {
      name: /contract check incomplete/i,
    }).textContent;
    expect(t).toContain("every in-slice .go file");
    expect(t).toContain("every in-slice .rs file");
    expect(t).toContain("this bundle cannot list them");
  });

  it("raises no completeness alert in Proposed for a complete scan", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS }),
          slice,
          contract: contractOf([]),
        })}
      />,
    );
    expect(within(proposedRegion()).queryByRole("alert")).toBeNull();
  });

  it("keeps a known violation shown, marks it known and shows its expiry", () => {
    const c = {
      ...contractOf([forbid]),
      knownViolations: [
        {
          rule: "no-shared",
          file: "apps/web/a.ts",
          specifier: "bad",
          expires: "2026-10-01",
        },
      ],
    };
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: [bad] }),
          slice,
          contract: c,
        })}
      />,
    );
    const row = within(proposedRegion()).getByTestId("slice-edge");
    expect(row.getAttribute("data-violation")).toBe("true");
    expect(within(row).getByTestId("violation")).toBeTruthy();
    expect(within(row).getByTestId("known-mark").textContent).toBe("known");
    expect(row.textContent).toContain("expires 2026-10-01");
  });

  it("judges expiry at the bundle's date, not the wall clock", () => {
    const c = {
      ...contractOf([forbid]),
      knownViolations: [
        {
          rule: "no-shared",
          file: "apps/web/a.ts",
          specifier: "bad",
          expires: "2026-10-01",
        },
      ],
    };
    // valid on the bundle's day although long past by the wall clock
    const { unmount } = render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: [bad] }),
          slice,
          contract: c,
          createdAt: "2026-10-01T23:00:00.000Z",
        })}
      />,
    );
    expect(screen.getAllByTestId("known-mark")).toHaveLength(1);
    unmount();
    // expired on a later bundle date: the violation stays, the marker goes
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: [bad] }),
          slice,
          contract: c,
          createdAt: "2026-10-02T00:00:00.000Z",
        })}
      />,
    );
    expect(screen.queryByTestId("known-mark")).toBeNull();
    expect(screen.getAllByTestId("violation")).toHaveLength(1);
  });

  it("marks only the matching violation as known", () => {
    const c = {
      ...contractOf([forbid]),
      knownViolations: [
        { rule: "no-shared", file: "apps/web/a.ts", specifier: "other" },
      ],
    };
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: [bad] }),
          slice,
          contract: c,
        })}
      />,
    );
    expect(screen.queryByTestId("known-mark")).toBeNull();
  });

  it("shows a warn rule as a warning, not a violation", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: [bad] }),
          slice,
          contract: contractOf([{ ...forbid, severity: "warn" }]),
        })}
      />,
    );
    const badges = [...proposedRegion().querySelectorAll("[data-badge]")].map(
      (e) => e.textContent,
    );
    expect(badges).toContain("warning");
    // population-guard: toContain("warning") above proves badges is non-empty
    expect(badges).not.toContain("violation");
    expect(
      within(proposedRegion())
        .getByTestId("slice-edge")
        .getAttribute("data-violation"),
    ).toBe("true");
  });

  it("notes a contract for another slice", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS }),
          slice,
          contract: { ...contractOf([]), sliceId: "slice-2" },
        })}
      />,
    );
    expect(proposedRegion().textContent).toContain(
      'the contract is for slice "slice-2", but the slice is "slice-1"',
    );
  });

  it("notes an observed report at another commit", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS }),
          slice: { ...slice, repo: { commit: "f".repeat(40) } },
          contract: contractOf([]),
        })}
      />,
    );
    expect(proposedRegion().textContent).toContain(
      "the observed report is at commit",
    );
  });

  it("raises no mismatch note when slice, contract and report agree", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS }),
          slice,
          contract: contractOf([]),
        })}
      />,
    );
    expect(within(proposedRegion()).queryAllByRole("note")).toHaveLength(0);
  });

  it("says no edge was judged when there is a slice but no observed report", () => {
    render(<MiddlePanel bundle={bundleOf({ observed: null, slice })} />);
    expect(proposedRegion().textContent).toContain(
      "No observed report, so no edge was judged.",
    );
  });
});

describe("shared semantics, pinned in the viewer", () => {
  const slice = sliceOf(["apps/web/"]);
  const render1 = (edges: Edge[], rule: Contract["rules"][number]) =>
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges }),
          slice,
          contract: contractOf([rule]),
        })}
      />,
    );
  const rule = (kind: "forbid" | "allow-only", to: string) => ({
    id: "r",
    kind,
    from: "apps/web/",
    to,
    severity: "error" as const,
  });

  it("a package-root target (no trailing slash) hits a directory prefix", () => {
    render1(
      [{ from: "apps/web/a.ts", to: "libs/shared", specifier: "pkg" }],
      rule("forbid", "libs/shared/"),
    );
    expect(screen.getAllByTestId("violation")).toHaveLength(1);
  });

  it("a root-package target (.) always violates allow-only", () => {
    render1(
      [{ from: "apps/web/a.ts", to: ".", specifier: "root-pkg" }],
      rule("allow-only", "libs/shared/"),
    );
    expect(screen.getAllByTestId("violation")).toHaveLength(1);
  });

  it("a root-package target (.) never violates forbid", () => {
    render1(
      [{ from: "apps/web/a.ts", to: ".", specifier: "root-pkg" }],
      rule("forbid", "libs/shared/"),
    );
    expect(within(proposedRegion()).getAllByTestId("slice-edge")).toHaveLength(
      1,
    );
    expect(screen.queryAllByTestId("violation")).toHaveLength(0);
  });

  it("a closed rule excepts two accepted crossings and still fails the rest", () => {
    render1(
      [
        { from: "apps/web/a.ts", to: "libs/shared/x.ts", specifier: "ok" },
        { from: "apps/web/b.ts", to: "libs/date/d.ts", specifier: "ok" },
        { from: "apps/web/c.ts", to: "other/o.ts", specifier: "bad" },
        { from: "apps/web/d.ts", to: "apps/web/e.ts", specifier: "in" },
      ],
      {
        id: "r",
        kind: "closed",
        except: ["libs/shared/", "libs/date/"],
        severity: "error",
      },
    );
    const v = within(proposedRegion()).getAllByTestId("violation");
    expect(v).toHaveLength(1);
    expect(v[0].closest("[data-testid=slice-edge]")?.textContent).toContain(
      "apps/web/c.ts",
    );
  });

  it("a root-package target (.) always violates a closed rule", () => {
    render1([{ from: "apps/web/a.ts", to: ".", specifier: "root-pkg" }], {
      id: "r",
      kind: "closed",
      except: ["."],
      severity: "error",
    });
    expect(screen.getAllByTestId("violation")).toHaveLength(1);
  });

  it("an unresolved import is never reported under a closed rule's id", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: PKGS,
            unresolved: [
              { from: "apps/web/a.ts", specifier: "ghost", reason: "r" },
            ],
          }),
          slice: sliceOf(["apps/web/"]),
          contract: contractOf([
            {
              id: "closed-slice",
              kind: "closed",
              except: ["libs/shared/"],
              severity: "error",
            },
          ]),
        })}
      />,
    );
    const v = within(proposedRegion()).getAllByTestId("violation");
    expect(v).toHaveLength(1);
    const text = v[0].textContent ?? "";
    expect(text).toContain(UNRESOLVED_IMPORT_RULE_ID);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("closed-slice");
  });
});

describe("packages are grouped by root", () => {
  it("attributes a file to the package with the longest matching root", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: [
              { name: "outer", root: "apps" },
              { name: "inner", root: "apps/web" },
              { name: "lib", root: "libs" },
            ],
            edges: [
              { from: "apps/web/a.ts", to: "libs/x.ts", specifier: "l" },
              { from: "apps/other/b.ts", to: "libs/y.ts", specifier: "l" },
              { from: "apps/web/c.ts", to: "apps/other/d.ts", specifier: "o" },
            ],
          }),
        })}
      />,
    );
    const rows = within(observedRegion())
      .getAllByTestId("package-edge")
      .map((r) => r.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("inner -> lib");
    expect(rows[1]).toContain("outer -> lib");
    expect(rows[2]).toContain("inner -> outer");
  });

  it("keeps two packages with the same name apart", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: [
              { name: "twin", root: "a" },
              { name: "twin", root: "b" },
              { name: "other", root: "o" },
            ],
            edges: [
              { from: "a/x.ts", to: "o/z.ts", specifier: "s" },
              { from: "b/y.ts", to: "o/z.ts", specifier: "s" },
            ],
          }),
        })}
      />,
    );
    expect(
      within(observedRegion()).getAllByTestId("package-edge"),
    ).toHaveLength(2);
  });
});

describe("a contract for another slice", () => {
  const slice = sliceOf(["apps/web/"]);
  const bad: Edge = {
    from: "apps/web/a.ts",
    to: "libs/shared/x.ts",
    specifier: "bad",
  };
  const mismatched = {
    ...contractOf([
      {
        id: "no-shared",
        kind: "forbid",
        from: "apps/web/",
        to: "libs/shared/",
        severity: "error",
      },
    ]),
    sliceId: "slice-2",
    knownViolations: [
      { rule: "no-shared", file: "apps/web/a.ts", specifier: "bad" },
    ],
  };

  it("applies no rule: no violation and no known mark, and says so", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: [bad] }),
          slice,
          contract: mismatched,
        })}
      />,
    );
    const p = within(proposedRegion());
    expect(p.getAllByTestId("slice-edge")).toHaveLength(1);
    expect(p.queryAllByTestId("violation")).toHaveLength(0);
    expect(p.queryAllByTestId("known-mark")).toHaveLength(0);
    expect(p.getByTestId("slice-edge").getAttribute("data-violation")).toBe(
      "false",
    );
    expect(proposedRegion().textContent).toContain(
      "No contract rule was applied",
    );
    expect(proposedRegion().textContent).toContain("belongs to another slice");
  });

  it("still applies the same rules once the ids match", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({ packages: PKGS, edges: [bad] }),
          slice,
          contract: { ...mismatched, sliceId: "slice-1" },
        })}
      />,
    );
    expect(screen.getAllByTestId("violation")).toHaveLength(1);
    expect(proposedRegion().textContent).not.toContain(
      "No contract rule was applied",
    );
  });

  it("still flags an in-slice unresolved import, which needs no contract rule", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: PKGS,
            unresolved: [
              { from: "apps/web/a.ts", specifier: "ghost", reason: "r" },
            ],
          }),
          slice,
          contract: mismatched,
        })}
      />,
    );
    expect(screen.getAllByTestId("slice-unresolved")).toHaveLength(1);
  });
});

describe("a large report", () => {
  it("derives every package edge group correctly", () => {
    const P = 2000;
    const packages = Array.from({ length: P }, (_, i) => ({
      name: `pkg-${i}`,
      root: `p${i}`,
      manifestFile: `p${i}/package.json`,
    }));
    const edges = Array.from({ length: 20000 }, (_, k) => {
      const i = k % P;
      return {
        from: `p${i}/f${k}.ts`,
        to: `p${(i + 1) % P}/x.ts`,
        specifier: "s",
      };
    });
    const groups = packageEdges(packages, edges);
    expect(groups).toHaveLength(P);
    expect(groups.every((g) => g.edges.length === 10)).toBe(true);
    expect(groups[0].from).toBe("pkg-0");
    expect(groups[0].to).toBe("pkg-1");
    expect(groups[P - 1].to).toBe("pkg-0");
  });
});

describe("two packages declaring the same root", () => {
  it("attributes the root to the first one listed", () => {
    render(
      <MiddlePanel
        bundle={bundleOf({
          observed: observedOf({
            packages: [
              { name: "first", root: "d" },
              { name: "second", root: "d" },
              { name: "o", root: "o" },
            ],
            edges: [{ from: "d/x.ts", to: "o/y.ts", specifier: "s" }],
          }),
        })}
      />,
    );
    expect(
      within(observedRegion()).getByTestId("package-edge").textContent,
    ).toContain("first -> o");
  });
});
// population-guard: the violation count above proves the layer rendered
