import { describe, it, expect } from "vitest";

import {
  UNKNOWN_FRESH_FINDING_COUNT,
  deriveScanId,
  freshFindingCountOf,
  packagesFromLayoutDraft,
  readDetectedPackages,
  scanFromHandoff,
} from "./scan-artifacts";
import type { ProjectHandoffResponse } from "@/lib/project-scan/artifact-parse";

/**
 * The layout `runAdopt` actually writes: `contexts: { <name>: { root, layers } }`
 * (see `serializeLayout` in packages/sync/src/commands/adopt/index.ts). The
 * fixture is a literal of that shape rather than a hand-rolled approximation,
 * because the point of this module is agreeing with that producer.
 */
const REAL_LAYOUT = `contexts:
  orders:
    root: packages/orders
    layers:
      domain:
        - src/domain
      infrastructure:
        - src/db
        - src/http
  billing:
    root: packages/billing
    layers:
      domain:
        - src/core
`;

describe("readDetectedPackages", () => {
  it("reads the contexts block adopt writes into the list S3 edits", () => {
    const reading = readDetectedPackages(REAL_LAYOUT);

    expect(reading.problem).toBe(null);
    expect(reading.packages.map((pkg) => pkg.root)).toEqual([
      "packages/orders",
      "packages/billing",
    ]);
    expect(reading.packages[0].name).toBe("orders");
    expect(reading.packages[0].layers).toEqual({
      domain: ["src/domain"],
      infrastructure: ["src/db", "src/http"],
    });
  });

  it("drops layer keys the S3 editor cannot show", () => {
    const reading = readDetectedPackages(
      "contexts:\n  orders:\n    root: packages/orders\n    layers:\n      telemetry: [src/otel]\n      domain: [src/domain]\n",
    );

    expect(reading.packages[0].layers).toEqual({ domain: ["src/domain"] });
  });

  it("does NOT invent a root for a context that has none", () => {
    // `ContextLayoutSchema` requires `root`, so falling back to the context name
    // would hand the user a path to ratify that the linter would reject.
    const reading = readDetectedPackages(
      "contexts:\n  orders: {}\n  billing:\n    root: packages/billing\n",
    );

    expect(reading.packages.map((pkg) => pkg.root)).toEqual([
      "packages/billing",
    ]);
    expect(reading.problem).toMatch(/orders/);
    expect(reading.problem).toMatch(/root/);
  });

  it("reports a truncated layout as truncated, not as invalid", () => {
    // Both producers clip with a trailing "\n…". A clipped document is not a
    // broken repository, and saying so is the difference between "run the scan
    // again" and "your layout.yaml is wrong".
    const reading = readDetectedPackages(`${REAL_LAYOUT.slice(0, 40)}\n…`);

    expect(reading.packages).toEqual([]);
    expect(reading.problem).toMatch(/truncated/i);
    expect(reading.problem).toMatch(/CLI/);
  });

  it("never reports an empty package list without saying why", () => {
    for (const input of [
      null,
      undefined,
      "",
      "   ",
      "contexts:\n  - not: a mapping\n",
      "just a string",
      "version: 1\n",
    ]) {
      const reading = readDetectedPackages(input);
      if (reading.packages.length === 0) {
        expect(reading.problem).toBeTruthy();
      }
    }
  });

  it("names the pattern dialect rather than showing an empty grid", () => {
    const reading = readDetectedPackages('contexts: "packages/*"\n');

    expect(reading.packages).toEqual([]);
    expect(reading.problem).toMatch(/packages\/\*/);
  });

  it("does not throw on YAML it cannot parse", () => {
    const reading = readDetectedPackages("contexts:\n  orders:\n   - [a: b\n");

    expect(reading.packages).toEqual([]);
    expect(reading.problem).toBeTruthy();
  });
});

describe("packagesFromLayoutDraft", () => {
  it("rebuilds rows for a resumed run, which has no scan to read", () => {
    const packages = packagesFromLayoutDraft({
      contexts: [
        {
          packageRoot: "packages/orders",
          contextName: "orders",
          layerDirectories: { domain: ["src/domain"] },
        },
      ],
    });

    expect(packages).toEqual([
      {
        root: "packages/orders",
        name: "orders",
        layers: { domain: ["src/domain"] },
      },
    ]);
  });

  it("is empty for an absent draft rather than throwing", () => {
    // population-guard: emptiness IS the contract — a null draft has no packages.
    expect(packagesFromLayoutDraft(null)).toEqual([]);
    expect(packagesFromLayoutDraft(undefined)).toEqual([]);
  });
});

describe("freshFindingCountOf", () => {
  it("is the deduped fresh count when the findings were read", () => {
    const count = freshFindingCountOf({
      findings: {
        collected: true,
        fresh: [
          { rule: "r", file: "a.ts", specifier: "zod", message: "" },
          { rule: "r", file: "b.ts", specifier: "zod", message: "" },
        ],
        baselined: [],
        stale: [],
        expired: [],
      },
    });

    expect(count).toBe(2);
  });

  it("is zero — and therefore skips S5 — only for a genuinely clean read", () => {
    expect(
      freshFindingCountOf({
        findings: {
          collected: true,
          fresh: [],
          baselined: [],
          stale: [],
          expired: [],
        },
      }),
    ).toBe(0);
  });

  it("is NOT zero when the findings were never reported", () => {
    // The whole point. A zero here would take the machine's zero-fresh shortcut
    // straight to `report` and present an unmeasured tree as clean.
    expect(freshFindingCountOf({ findings: null })).toBe(
      UNKNOWN_FRESH_FINDING_COUNT,
    );
    expect(freshFindingCountOf({ findings: undefined })).not.toBe(0);
  });

  it("is NOT zero when the findings could not be collected", () => {
    expect(
      freshFindingCountOf({
        findings: {
          collected: false,
          failureReason: "hexagen-lint was not on PATH",
          fresh: [],
          baselined: [],
          stale: [],
          expired: [],
        },
      }),
    ).not.toBe(0);
  });
});

function handoff(
  overrides: Partial<ProjectHandoffResponse> = {},
): ProjectHandoffResponse {
  return {
    source: "handoff-artifacts",
    verdict: "ingested",
    exitCode: null,
    projectName: "Acme",
    layoutExcerpt: REAL_LAYOUT,
    filesScanned: null,
    reportMarkdown: "# report",
    errorMessage: null,
    artifacts: {
      present: [],
      missing: [],
      reportHtmlPresent: false,
      manifestExcerpt: null,
      suppressions: [],
      suppressionCount: 0,
      baselineVersion: null,
      baselineEntryCount: null,
    },
    warnings: [],
    ...overrides,
  } as ProjectHandoffResponse;
}

describe("scanFromHandoff", () => {
  it("never claims a handoff carried findings", () => {
    // A handoff has no findings list at all, so S6 must classify it as
    // unreadable rather than as a clean tree. This is the property that keeps
    // the gate installer blocked on a Tier-A run.
    expect(scanFromHandoff(handoff()).findings).toBe(null);
    expect(freshFindingCountOf(scanFromHandoff(handoff()))).toBe(
      UNKNOWN_FRESH_FINDING_COUNT,
    );
  });

  it("maps an incomplete upload onto could-not-run, with a reason", () => {
    const scan = scanFromHandoff(handoff({ verdict: "incomplete" }));

    expect(scan.verdict).toBe("could-not-run");
    expect(scan.errorMessage).toBeTruthy();
  });

  it("keeps the server's own message when there is one", () => {
    const scan = scanFromHandoff(
      handoff({ verdict: "incomplete", errorMessage: "no report in the zip" }),
    );

    expect(scan.errorMessage).toBe("no report in the zip");
  });

  it("carries the layout through, which is what S3 reads", () => {
    const reading = readDetectedPackages(
      scanFromHandoff(handoff()).layoutExcerpt,
    );

    expect(reading.packages).toHaveLength(2);
  });
});

describe("deriveScanId", () => {
  it("produces an id the install-gate route accepts", () => {
    const accepted = /^[A-Za-z0-9._-]{1,64}$/;

    for (const name of [
      "Acme Corp",
      "@acme/orders",
      "  ",
      "!!!",
      "a".repeat(200),
      "Ünïcødé",
    ]) {
      expect(accepted.test(deriveScanId(name, "abc123"))).toBe(true);
    }
  });

  it("is still valid when the suffix contributes nothing", () => {
    const accepted = /^[A-Za-z0-9._-]{1,64}$/;

    expect(accepted.test(deriveScanId("", ""))).toBe(true);
    expect(accepted.test(deriveScanId("!!!", "!!!"))).toBe(true);
  });

  it("names the bundle after the project, so a download is recognisable", () => {
    expect(deriveScanId("Acme Orders", "k9")).toBe("Acme-Orders-k9");
  });

  it("distinguishes two runs of the same project", () => {
    expect(deriveScanId("Acme", "aaa")).not.toBe(deriveScanId("Acme", "bbb"));
  });
});
