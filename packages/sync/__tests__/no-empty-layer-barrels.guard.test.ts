import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-wide guard: no `index.ts` under `packages/`, `apps/`, or `tools/` is an
 * empty `export {};` layer barrel.
 *
 * Why this exists. ADR-0050 §1 retired the convention of stamping every
 * hexagonal layer directory with an `export {};` barrel, and Wave C 6.7(a)
 * (#554, HEX-025) stopped the generator emitting layer folders that have no
 * content. Twenty pre-ADR barrels survived both: twenty files that exported
 * nothing, were imported by nothing, and read to every linter and every agent
 * as a layer that existed. P4.1 of the 2026-08-23 enforcement plan deleted
 * them. This is the checked form of that deletion — `package-src-index.ts`
 * says it in one line: "Empty layer `export {}` barrels used to be those
 * inputs; they must not come back."
 *
 * What it does NOT cover. A package whose `src/` has no layers at all keeps a
 * single `src/index.ts` stub of the same shape, written by
 * `ensurePackageSrcIndex` so `tsc` has an input (TS18003). That stub sits at
 * the package root, not in a layer directory, and is the sanctioned
 * replacement for the layer barrels — so the match below is scoped to the
 * three layer directory names and nothing else.
 *
 * Non-vacuity. The walk is anchored on files that must be found (the guard's
 * own package, a known populated layer barrel) before the zero-match assertion
 * runs. A grep over an empty tree reports zero findings too; that is the
 * pattern this guard exists to end, not one it may exhibit.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** Roots that hold workspace source. `docs/`, `.architecture/` etc. hold none. */
const SOURCE_ROOTS = ["packages", "apps", "tools"];

/** Hexagonal layer directory names — the only places the old convention lived. */
const LAYER_DIRS = new Set(["domain", "application", "infrastructure"]);

/**
 * Never entered. `node_modules` and build outputs are derived; `.claude` holds
 * parallel agent worktrees whose residue is not this tree's (see the sibling
 * `no-jest-residue` guard for the same reasoning); `publish/` is the staged
 * tarball directory `prepare-publish-package.js` writes.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".yarn",
  ".claude",
  "dist",
  "dist-test",
  ".next",
  ".turbo",
  "coverage",
  "publish",
]);

type Found = {
  /** Every `index.ts` whose parent directory is a layer directory. */
  layerBarrels: string[];
  /** The subset whose only statement is `export {};`. */
  emptyLayerBarrels: string[];
  /** Directories visited — an anchor for the walk having happened. */
  visited: number;
};

const rel = (absolute: string): string =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join("/");

/**
 * An empty barrel is one whose statements, once comments and blank lines are
 * removed, are exactly `export {};`. A barrel that re-exports anything is not
 * empty, whatever else it contains.
 */
export function isEmptyBarrel(source: string): boolean {
  const statements = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  return (
    statements.length === 1 && /^export\s*\{\s*\}\s*;?$/.test(statements[0])
  );
}

let discovery: Promise<Found> | undefined;
const walk = (): Promise<Found> => (discovery ??= traverse());

async function traverse(): Promise<Found> {
  const found: Found = { layerBarrels: [], emptyLayerBarrels: [], visited: 0 };

  async function visit(dir: string): Promise<void> {
    found.visited += 1;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(absolute);
        continue;
      }
      if (entry.name !== "index.ts") continue;
      if (!LAYER_DIRS.has(path.basename(dir))) continue;
      found.layerBarrels.push(absolute);
      if (isEmptyBarrel(await fs.readFile(absolute, "utf8"))) {
        found.emptyLayerBarrels.push(absolute);
      }
    }
  }

  for (const root of SOURCE_ROOTS) {
    await visit(path.join(REPO_ROOT, root));
  }
  return found;
}

describe("no empty layer barrels", () => {
  it("discovery reaches the source roots", async () => {
    const { layerBarrels, visited } = await walk();
    // Anchors, not magic numbers. The guard's own package has a populated
    // `src/application/index.ts`; if the walk cannot find it, it is rooted
    // somewhere unexpected and the zero-match assertion below is vacuous.
    assert.ok(
      visited > SOURCE_ROOTS.length,
      `walk visited only ${visited} directories from ${REPO_ROOT}`,
    );
    assert.ok(
      layerBarrels.some(
        (file) => rel(file) === "packages/sync/src/application/index.ts",
      ),
      `walk found ${layerBarrels.length} layer barrels and missed ` +
        `packages/sync/src/application/index.ts, the one next to this guard`,
    );
  });

  it("no layer directory carries an `export {};` barrel", async () => {
    const { emptyLayerBarrels } = await walk();
    assert.deepEqual(
      emptyLayerBarrels.map(rel).sort(),
      [],
      `ADR-0050 §1 retired empty layer barrels and #554 stopped emitting ` +
        `them. A layer with no content has no directory; a package with no ` +
        `layers has a single src/index.ts stub. Delete these, do not fill them.`,
    );
  });

  it("classifies barrels by their statements, not their bytes", () => {
    assert.equal(isEmptyBarrel("export {};\n"), true);
    assert.equal(isEmptyBarrel("export {}\n"), true);
    assert.equal(
      isEmptyBarrel("// @generated by @hexagen/sync\n\nexport {};\n"),
      true,
    );
    assert.equal(
      isEmptyBarrel("// header\nexport {};\nexport * from './x.js';\n"),
      false,
    );
    assert.equal(isEmptyBarrel("export * from './x.js';\n"), false);
    assert.equal(isEmptyBarrel("export type { A } from './a.js';\n"), false);
    assert.equal(isEmptyBarrel(""), false);
    assert.equal(isEmptyBarrel("// only a comment\n"), false);
  });
});
