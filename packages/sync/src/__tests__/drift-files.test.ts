import { describe, expect, it } from "vitest";
import {
  buildDriftFiles,
  createEmptyResult,
  type GeneratorResult,
} from "../results.js";

function row(
  label: string,
  overrides: Partial<GeneratorResult> = {},
): readonly [string, GeneratorResult] {
  return [label, { ...createEmptyResult(), ...overrides }];
}

describe("buildDriftFiles", () => {
  it("resolves an absolute path against the workspace root, relative to it", () => {
    const rows = [
      row("RootFiles", { created: ["/ws/packages/a/src/index.ts"] }),
    ];
    const files = buildDriftFiles(rows, "/ws");
    expect(files).toEqual([
      {
        path: "packages/a/src/index.ts",
        action: "create",
        generator: "RootFiles",
        reason: "missing on disk; sync would create it",
      },
    ]);
  });

  it("passes a relative path through unchanged", () => {
    const rows = [row("Layers", { created: ["packages/b/src/domain"] })];
    expect(buildDriftFiles(rows, "/ws")[0].path).toBe("packages/b/src/domain");
  });

  it("converts backslashes to forward slashes", () => {
    const rows = [row("Apps", { created: ["packages\\c\\src\\index.ts"] })];
    expect(buildDriftFiles(rows, "/ws")[0].path).toBe(
      "packages/c/src/index.ts",
    );
  });

  it("sets generator to the row label and action to the bucket, with fixed reasons", () => {
    const rows = [
      row("RootFiles", {
        created: ["a.ts"],
        updated: ["b.ts"],
        deleted: ["c.ts"],
        unchanged: ["d.ts"],
        skipped: ["e.ts"],
      }),
    ];
    expect(buildDriftFiles(rows, "/ws")).toEqual([
      {
        path: "a.ts",
        action: "create",
        generator: "RootFiles",
        reason: "missing on disk; sync would create it",
      },
      {
        path: "b.ts",
        action: "update",
        generator: "RootFiles",
        reason: "content differs from generated output",
      },
      {
        path: "c.ts",
        action: "delete",
        generator: "RootFiles",
        reason: "no longer generated; sync would remove it",
      },
    ]);
  });

  it("sorts by code point, not locale (B, _, a, b)", () => {
    const rows = [row("RootFiles", { created: ["b", "B", "a", "_"] })];
    const files = buildDriftFiles(rows, "/ws");
    expect(files.map((f) => f.path)).toEqual(["B", "_", "a", "b"]);
  });

  it("sorts identically when the rows arrive in reverse order", () => {
    const rows = [
      row("Layers", { created: ["b"] }),
      row("Apps", { created: ["a"] }),
      row("Barrels", { created: ["_"] }),
      row("RootFiles", { created: ["B"] }),
    ];
    const files = buildDriftFiles(rows, "/ws");
    expect(files.map((f) => f.path)).toEqual(["B", "_", "a", "b"]);
  });

  it("drops duplicates with the same path, action and generator", () => {
    const rows = [
      row("Barrels", { created: ["pkg/x.ts"] }),
      row("Barrels", { created: ["pkg/x.ts"] }),
    ];
    expect(buildDriftFiles(rows, "/ws")).toHaveLength(1);
  });

  it("keeps the same path when the generator differs", () => {
    const rows = [
      row("Barrels", { created: ["pkg/x.ts"] }),
      row("RootFiles", { created: ["pkg/x.ts"] }),
    ];
    expect(buildDriftFiles(rows, "/ws")).toHaveLength(2);
  });

  it("returns [] for empty rows", () => {
    expect(buildDriftFiles([], "/ws")).toEqual([]);
  });
});
