import { describe, it, expect } from "vitest";

import {
  LAYOUT_LAYERS,
  buildLayoutRatifyRows,
  canRatifyLayout,
  hasNoDetectedLayers,
  isLayoutRowEdited,
  layoutRowChanges,
  mergeRatifiedDraft,
  normalizeDirectories,
  normalizeDirectory,
  renameContext,
  resetRowToDetected,
  setContextIncluded,
  setLayerDirectories,
  toLayoutDraft,
  validateLayoutRows,
  type DetectedPackageSummary,
} from "./layout-draft";

/**
 * The seven-package shape the S3 wireframe is drawn against: two obvious
 * contexts, one tooling package with no layer directories.
 */
function detected(): DetectedPackageSummary[] {
  return [
    {
      root: "packages/orders",
      name: "orders",
      layers: {
        domain: ["src/domain"],
        application: ["src/application"],
        infrastructure: ["src/db", "src/http"],
      },
    },
    {
      root: "packages/billing",
      name: "billing",
      layers: { domain: ["src/core"] },
    },
    { root: "packages/eslint-config", name: "eslint-config", layers: {} },
  ];
}

describe("normalizeDirectory", () => {
  it("folds the spellings that would otherwise become two directories", () => {
    expect(normalizeDirectory("  src/domain  ")).toBe("src/domain");
    expect(normalizeDirectory("./src/domain")).toBe("src/domain");
    expect(normalizeDirectory("src/domain/")).toBe("src/domain");
    expect(normalizeDirectory("src\\domain")).toBe("src/domain");
    expect(normalizeDirectory("src//domain")).toBe("src/domain");
    expect(normalizeDirectory("././src/domain//")).toBe("src/domain");
  });

  it("reduces an unusable directory to the empty string", () => {
    expect(normalizeDirectory("   ")).toBe("");
    expect(normalizeDirectory("./")).toBe("");
    expect(normalizeDirectory("/")).toBe("");
  });
});

describe("normalizeDirectories", () => {
  it("drops empties and dedupes AFTER normalizing, keeping first-seen order", () => {
    // ChipInput dedupes raw strings, so these three arrive as three chips and
    // must collapse to one directory here or the layout gets duplicates.
    expect(
      normalizeDirectories(["src/domain", "./src/domain", "src/domain/", ""]),
    ).toEqual(["src/domain"]);
    expect(normalizeDirectories(["src/http", "src/db"])).toEqual([
      "src/http",
      "src/db",
    ]);
  });
});

describe("buildLayoutRatifyRows", () => {
  it("keeps detection order and gives every row all four layer keys", () => {
    const rows = buildLayoutRatifyRows(detected());
    expect(rows.map((row) => row.packageRoot)).toEqual([
      "packages/orders",
      "packages/billing",
      "packages/eslint-config",
    ]);
    for (const row of rows) {
      expect(Object.keys(row.layerDirectories).sort()).toEqual(
        [...LAYOUT_LAYERS].sort(),
      );
    }
  });

  it("includes a package with detected layers and excludes one without", () => {
    // The evidence rule, and the reason the wireframe shows eslint-config
    // unticked: `bootstrap --yes` included everything, which is the
    // non-decision this screen exists to replace.
    const rows = buildLayoutRatifyRows(detected());
    expect(rows.map((row) => row.include)).toEqual([true, true, false]);
    expect(hasNoDetectedLayers(rows[2])).toBe(true);
  });

  it("ignores layer keys the editor cannot show", () => {
    const rows = buildLayoutRatifyRows([
      {
        root: "packages/orders",
        name: "orders",
        layers: { domain: ["src/domain"], telemetry: ["src/otel"] },
      },
    ]);
    expect(Object.keys(rows[0].layerDirectories).sort()).toEqual(
      [...LAYOUT_LAYERS].sort(),
    );
    expect(JSON.stringify(rows[0].layerDirectories)).not.toMatch(/src\/otel/);
  });

  it("drops a repeated root rather than creating two rows with one identity", () => {
    const rows = buildLayoutRatifyRows([
      { root: "packages/orders", name: "orders", layers: {} },
      { root: "./packages/orders/", name: "orders-again", layers: {} },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].contextName).toBe("orders");
  });

  it("keeps the detector's proposal isolated from later edits", () => {
    const rows = buildLayoutRatifyRows(detected());
    const edited = setLayerDirectories(
      rows,
      "packages/orders",
      "domain",
      ["src/model"],
    );
    expect(edited[0].detectedLayerDirectories.domain).toEqual(["src/domain"]);
    expect(edited[0].layerDirectories.domain).toEqual(["src/model"]);
  });

  it("renders a single-package repo as '.'", () => {
    const rows = buildLayoutRatifyRows([
      { root: ".", name: "checkout", layers: { domain: ["src/domain"] } },
    ]);
    expect(rows[0].packageRoot).toBe(".");
  });
});

describe("row transforms", () => {
  it("returns the same array when nothing changed", () => {
    const rows = buildLayoutRatifyRows(detected());
    expect(setContextIncluded(rows, "packages/orders", true)).toBe(rows);
    expect(renameContext(rows, "packages/orders", "orders")).toBe(rows);
    expect(setContextIncluded(rows, "packages/nope", false)).toBe(rows);
    expect(
      setLayerDirectories(rows, "packages/billing", "domain", ["./src/core/"]),
    ).toBe(rows);
  });

  it("leaves untouched rows at their original identity", () => {
    const rows = buildLayoutRatifyRows(detected());
    const next = setContextIncluded(rows, "packages/eslint-config", true);
    expect(next).not.toBe(rows);
    expect(next[0]).toBe(rows[0]);
    expect(next[2]).not.toBe(rows[2]);
    expect(next[2].include).toBe(true);
  });

  it("stores a rename exactly as typed so the field stays editable", () => {
    const rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/orders",
      "order ",
    );
    expect(rows[0].contextName).toBe("order ");
  });

  it("normalizes layer directories on the way in", () => {
    const rows = setLayerDirectories(
      buildLayoutRatifyRows(detected()),
      "packages/billing",
      "infrastructure",
      ["./src/db/", "src/db", "", "src/http"],
    );
    expect(rows[1].layerDirectories.infrastructure).toEqual([
      "src/db",
      "src/http",
    ]);
  });

  it("restores the detector's proposal, include flag included", () => {
    let rows = buildLayoutRatifyRows(detected());
    rows = renameContext(rows, "packages/orders", "ordering");
    rows = setLayerDirectories(rows, "packages/orders", "domain", []);
    rows = setContextIncluded(rows, "packages/orders", false);
    rows = resetRowToDetected(rows, "packages/orders");
    expect(rows[0].contextName).toBe("orders");
    expect(rows[0].layerDirectories.domain).toEqual(["src/domain"]);
    expect(rows[0].include).toBe(true);
    expect(isLayoutRowEdited(rows[0])).toBe(false);
  });
});

describe("layoutRowChanges", () => {
  it("separates a rename from a layer edit, and ignores whitespace", () => {
    const rows = buildLayoutRatifyRows(detected());
    expect(layoutRowChanges(rows[0])).toEqual({
      renamed: false,
      layersEdited: false,
    });

    const padded = renameContext(rows, "packages/orders", "  orders  ");
    expect(layoutRowChanges(padded[0]).renamed).toBe(false);

    const renamed = renameContext(rows, "packages/orders", "ordering");
    expect(layoutRowChanges(renamed[0])).toEqual({
      renamed: true,
      layersEdited: false,
    });

    const relayered = setLayerDirectories(rows, "packages/orders", "domain", [
      "src/model",
    ]);
    expect(layoutRowChanges(relayered[0])).toEqual({
      renamed: false,
      layersEdited: true,
    });
  });
});

describe("validateLayoutRows", () => {
  it("counts included, excluded and edited rows", () => {
    const rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/billing",
      "invoicing",
    );
    const validation = validateLayoutRows(rows);
    expect(validation.includedCount).toBe(2);
    expect(validation.excludedCount).toBe(1);
    expect(validation.editedCount).toBe(1);
    expect(validation.blockingReason).toBeNull();
  });

  it("blocks a collision between two INCLUDED contexts and names the other root", () => {
    // writeLayout builds `contexts[name] = {...}` — a duplicate does not throw,
    // the second entry silently overwrites the first and a context vanishes.
    const rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/billing",
      "orders",
    );
    const validation = validateLayoutRows(rows);
    expect(validation.errorCount).toBe(2);
    expect(validation.rowMessages["packages/billing"].text).toMatch(
      /packages\/orders/,
    );
    expect(validation.rowMessages["packages/orders"].text).toMatch(
      /packages\/billing/,
    );
    expect(validation.blockingReason).toMatch(/context names/i);
    expect(canRatifyLayout(rows)).toBe(false);
  });

  it("treats a case-only collision as a collision", () => {
    const rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/billing",
      "Orders",
    );
    expect(validateLayoutRows(rows).errorCount).toBe(2);
  });

  it("does not let an EXCLUDED row collide — excluding is a valid fix", () => {
    let rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/billing",
      "orders",
    );
    rows = setContextIncluded(rows, "packages/billing", false);
    const validation = validateLayoutRows(rows);
    expect(validation.errorCount).toBe(0);
    expect(validation.blockingReason).toBeNull();
  });

  it("rejects an empty name and a name that would corrupt the YAML key", () => {
    let rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/orders",
      "   ",
    );
    expect(validateLayoutRows(rows).rowMessages["packages/orders"].severity).toBe(
      "error",
    );

    rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/orders",
      "order service",
    );
    expect(validateLayoutRows(rows).rowMessages["packages/orders"].text).toMatch(
      /spaces, slashes/,
    );

    rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/orders",
      "orders/v2",
    );
    expect(validateLayoutRows(rows).errorCount).toBe(1);
  });

  it("accepts the ordinary names the detector itself emits", () => {
    const rows = buildLayoutRatifyRows([
      { root: "packages/a", name: "order-service", layers: { domain: ["s"] } },
      { root: "packages/b", name: "Order_Service.v2", layers: { domain: ["s"] } },
    ]);
    expect(validateLayoutRows(rows).errorCount).toBe(0);
  });

  it("warns — but does not block — on an included context with no layers", () => {
    // writeLayout omits `layers` entirely when nothing was detected, so a
    // root-only entry is a shape the artifact already supports.
    const rows = setContextIncluded(
      buildLayoutRatifyRows(detected()),
      "packages/eslint-config",
      true,
    );
    const validation = validateLayoutRows(rows);
    expect(validation.rowMessages["packages/eslint-config"].severity).toBe(
      "warning",
    );
    expect(validation.errorCount).toBe(0);
    expect(validation.blockingReason).toBeNull();
  });

  it("blocks a layout with nothing included, and says why", () => {
    let rows = buildLayoutRatifyRows(detected());
    for (const row of rows) {
      rows = setContextIncluded(rows, row.packageRoot, false);
    }
    const validation = validateLayoutRows(rows);
    expect(validation.includedCount).toBe(0);
    expect(validation.blockingReason).toMatch(/checks nothing/);
    expect(canRatifyLayout(rows)).toBe(false);
  });

  it("blocks a scan that detected no packages at all", () => {
    const validation = validateLayoutRows(buildLayoutRatifyRows([]));
    expect(validation.blockingReason).toMatch(/no workspace packages/);
  });
});

describe("toLayoutDraft", () => {
  it("writes only included rows, trimmed, in order", () => {
    const rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/billing",
      "  invoicing  ",
    );
    const draft = toLayoutDraft(rows);
    expect(draft.contexts.map((context) => context.contextName)).toEqual([
      "orders",
      "invoicing",
    ]);
    expect(draft.contexts.map((context) => context.packageRoot)).toEqual([
      "packages/orders",
      "packages/billing",
    ]);
  });

  it("omits an empty layer rather than asserting it exists and is empty", () => {
    const draft = toLayoutDraft(buildLayoutRatifyRows(detected()));
    expect(Object.keys(draft.contexts[0].layerDirectories).sort()).toEqual([
      "application",
      "domain",
      "infrastructure",
    ]);
    expect(draft.contexts[1].layerDirectories).toEqual({
      domain: ["src/core"],
    });
  });

  it("copies the directory arrays out of the row", () => {
    const rows = buildLayoutRatifyRows(detected());
    const draft = toLayoutDraft(rows);
    draft.contexts[0].layerDirectories.domain.push("src/leak");
    expect(rows[0].layerDirectories.domain).toEqual(["src/domain"]);
  });
});

describe("mergeRatifiedDraft", () => {
  it("round-trips a draft produced by toLayoutDraft", () => {
    let rows = buildLayoutRatifyRows(detected());
    rows = renameContext(rows, "packages/billing", "invoicing");
    rows = setLayerDirectories(rows, "packages/billing", "infrastructure", [
      "src/db",
    ]);
    const draft = toLayoutDraft(rows);

    const restored = mergeRatifiedDraft(buildLayoutRatifyRows(detected()), draft);
    expect(toLayoutDraft(restored)).toEqual(draft);
  });

  it("re-excludes a row the draft does not carry", () => {
    const rows = buildLayoutRatifyRows(detected());
    const draft = toLayoutDraft(
      setContextIncluded(rows, "packages/billing", false),
    );
    const restored = mergeRatifiedDraft(rows, draft);
    expect(restored.map((row) => row.include)).toEqual([true, false, false]);
  });

  it("matches on package root, never on the name the user may have changed", () => {
    const rows = buildLayoutRatifyRows(detected());
    const restored = mergeRatifiedDraft(rows, {
      contexts: [
        {
          packageRoot: "packages/orders",
          contextName: "ordering",
          layerDirectories: { domain: ["src/domain"] },
        },
      ],
    });
    expect(restored[0].contextName).toBe("ordering");
    expect(restored[0].detectedContextName).toBe("orders");
    expect(isLayoutRowEdited(restored[0])).toBe(true);
  });

  it("re-includes a package the detector had left unticked", () => {
    const rows = buildLayoutRatifyRows(detected());
    const restored = mergeRatifiedDraft(rows, {
      contexts: [
        {
          packageRoot: "packages/eslint-config",
          contextName: "eslint-config",
          layerDirectories: {},
        },
      ],
    });
    expect(restored[2].include).toBe(true);
  });

  it("is inert without a draft", () => {
    const rows = buildLayoutRatifyRows(detected());
    expect(mergeRatifiedDraft(rows, null)).toBe(rows);
    expect(mergeRatifiedDraft(rows, undefined)).toBe(rows);
  });
});
describe("normalizeDirectory — path containment", () => {
  it("rejects parent-directory escapes", () => {
    // These land in layout.yaml and are path-joined against the package root
    // by the sync engine, which accepts them as-is.
    for (const hostile of ["../outside", "src/../../etc", "..", "a/../../b"]) {
      expect(normalizeDirectory(hostile), hostile).toBe("");
    }
  });

  it("rejects absolute paths", () => {
    for (const abs of ["/etc/passwd", "/", "//srv"]) {
      expect(normalizeDirectory(abs), abs).toBe("");
    }
  });

  it("still accepts ordinary relative directories", () => {
    // The guard must not be so blunt that real input is refused; note a dot
    // INSIDE a segment is fine, only a `..` segment is traversal.
    expect(normalizeDirectory("./src/domain/")).toBe("src/domain");
    expect(normalizeDirectory("src//application")).toBe("src/application");
    expect(normalizeDirectory("src/v1.2/domain")).toBe("src/v1.2/domain");
  });
});

