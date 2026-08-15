import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Toolchain-honesty guard (AUD toolchain-honesty / plan item 3.1).
 *
 * This package must not pin a TypeScript *major* ahead of the monorepo root
 * toolchain. A stray `typescript: ^6.0.3` here (while every other workspace and
 * the root sit on the 5.x line) silently compiled this package's `.d.ts` under a
 * different major than its six consumers typecheck against — a divergence the
 * audit flagged. The fix (3.1) deletes the pin so the package inherits the root
 * TypeScript; this test locks that in and fails loudly if a divergent major pin
 * is ever reintroduced.
 *
 * Scope is deliberately narrow — MAJOR only, this package only. The harmless
 * minor/patch drift across the 5.x workspaces is out of scope, and policing the
 * whole monorepo's pins is a separate concern; this guard defends exactly the
 * one package item 3.1 corrects.
 *
 * The comparison is on what a range can *select*, not on the first number in it:
 * `^5.0.0 || ^6.0.0` is ahead of a 5.x root even though it starts at 5, and
 * `>=5 <6` is not even though it never spells a full version. Shapes this guard
 * cannot prove an upper bound for (hyphen ranges, `npm:` protocol specs, …) fail
 * closed rather than passing silently.
 */

/** Read a workspace `package.json` relative to this test file. */
function readPkg(relativePath: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

/** The declared `typescript` spec (dev or prod dep), or `undefined` if unpinned. */
function typescriptSpec(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): string | undefined {
  return pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript;
}

/**
 * `[operator][major][.minor][.patch][-prerelease|+build]`, with `x`/`X`/`*`
 * wildcards allowed in the minor and patch positions. Anything else (hyphen
 * ranges, `npm:`/`workspace:` protocols, junk) deliberately fails to match.
 */
const COMPARATOR =
  /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Highest major a single comparator can select — `Infinity` when it is
 * unbounded above (`>=5`, `*`). Throws for shapes this guard cannot bound.
 */
function highestMajorOfComparator(comparator: string): number {
  if (comparator === "*" || comparator === "x" || comparator === "X") {
    return Infinity;
  }

  const match = COMPARATOR.exec(comparator);
  assert.ok(
    match,
    `unsupported version range "${comparator}" — this guard only understands ` +
      `simple comparators (^5.4.5, ~5.4, 5.x, >=5, <6, 5.9.3). Rewrite the ` +
      `spec or extend the guard; it fails closed rather than guessing.`,
  );

  // Omitted minor/patch positions default to 0, matching semver's own reading
  // of a partial comparator (`<6` means `<6.0.0`).
  const [, operator = "", majorText, minorText = "0", patchText = "0"] = match;
  const major = Number(majorText);

  switch (operator) {
    case ">":
    case ">=":
      // No upper bound at all: `>=5` happily selects 6.x.
      return Infinity;
    case "<":
      // `<6` / `<6.0.0` stop below major 6; `<6.1.0` still admits 6.0.x.
      return minorText === "0" && patchText === "0" ? major - 1 : major;
    default:
      // `^5.x`, `~5.4`, `<=5.9.3`, `5.x`, exact `5.9.3` — all capped at `major`.
      return major;
  }
}

/**
 * Highest major a whole semver range can select.
 *
 * Alternatives (`||`) widen the range, so the answer is the *max* across them;
 * comparators within one alternative intersect, so the answer there is the
 * *min* of their upper bounds (`>=5 <6` -> 5).
 */
function highestMajor(spec: string): number {
  const alternatives = spec.split("||");

  return Math.max(
    ...alternatives.map((alternative) => {
      const comparators = alternative.trim().split(/\s+/);
      assert.ok(
        comparators.length > 0 && comparators[0] !== "",
        `could not parse a version range from "${spec}"`,
      );
      return Math.min(...comparators.map(highestMajorOfComparator));
    }),
  );
}

/** Does `ownSpec` allow a TypeScript major beyond what `rootSpec` allows? */
function isAheadOfRoot(ownSpec: string, rootSpec: string): boolean {
  return highestMajor(ownSpec) > highestMajor(rootSpec);
}

describe("toolchain pin honesty (item 3.1)", () => {
  it("does not pin a TypeScript major ahead of the monorepo root", () => {
    const ownSpec = typescriptSpec(readPkg("../package.json"));

    // No self-pin is the intended end state: the package inherits the root
    // TypeScript, so there is nothing that can diverge.
    if (ownSpec === undefined) return;

    const rootSpec = typescriptSpec(readPkg("../../../package.json"));
    assert.ok(
      rootSpec,
      "monorepo root must declare a typescript version to anchor against",
    );

    assert.ok(
      !isAheadOfRoot(ownSpec, rootSpec),
      `agentic-interaction pins typescript ${ownSpec} (can select major ` +
        `${highestMajor(ownSpec)}), ahead of the root's ${rootSpec} (major ` +
        `${highestMajor(rootSpec)}). Remove the stray pin so this package uses ` +
        `the monorepo TypeScript (plan item 3.1).`,
    );
  });

  // The check above early-returns in the intended steady state (no self-pin),
  // so the invariant itself is exercised here against synthetic specs. This is
  // what keeps the RED reproducible in CI instead of only under a manual
  // guard-neutering mutation.
  describe("the invariant, against a 5.x root", () => {
    const root = "^5.4.5";

    const ahead = [
      "^6.0.3", // the pin item 3.1 deletes
      "^5.0.0 || ^6.0.0", // compound range whose second alternative reaches 6
      ">=5", // unbounded above
      "*", // anything, including 6
      "<6.1.0", // still admits 6.0.x
    ];
    for (const spec of ahead) {
      it(`rejects ${spec}`, () => {
        assert.equal(isAheadOfRoot(spec, root), true);
      });
    }

    const withinRoot = [
      "^5.4.5",
      "^5", // dotless major
      "5.x", // wildcard minor
      "~5.4",
      "5.9.3", // exact
      ">=5 <6", // bounded compound range
      ">=5.4.0 <6.0.0",
      "^4.9.5 || ^5.0.0", // every alternative stays at or below root
    ];
    for (const spec of withinRoot) {
      it(`accepts ${spec}`, () => {
        assert.equal(isAheadOfRoot(spec, root), false);
      });
    }

    it("fails closed on range shapes it cannot bound", () => {
      for (const spec of ["5.0.0 - 6.0.0", "npm:^6.0.3", "latest", ""]) {
        assert.throws(
          () => isAheadOfRoot(spec, root),
          /could not parse|unsupported version range/,
          `expected "${spec}" to fail closed`,
        );
      }
    });
  });
});
