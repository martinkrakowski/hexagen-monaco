import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { FOREIGN_OWNER, FOREIGN_REPO } from "./foreign-literals.js";

/**
 * The forbidden list, over every file this lane owns, tests included.
 *
 * Each entry below is a fact about ONE repository that was hardcoded where a
 * packaged tool has to read it from the project's overlay. Shipping any of them
 * would make the package work on that repository and nowhere else, and this
 * repository is public, so a fact of its own is also a leak.
 *
 * The two repository literals are assembled from fragments in
 * `foreign-literals.ts` and are never present in any file as contiguous
 * strings — so this test needs no exception for its own patterns, and no test
 * in this lane is an exception at all.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");

/** Every file this lane owns. A missing path is a failure of this test's own list. */
const OWNS: readonly string[] = [
  "src/bins/plan-review.ts",
  "src/bins/sweep.ts",
  "bin/merge-prs",
  "src/plan-review/cli.ts",
  "src/sweep/cli.ts",
  "src/sweep/lib/args.ts",
  "src/sweep/lib/attribute.ts",
  "src/sweep/lib/gate.ts",
  "src/sweep/lib/sweep.ts",
  "src/sweep/lib/types.ts",
];

/** One forbidden string, and what it would mean if a file carried it. */
interface Forbidden {
  readonly needle: string;
  readonly why: string;
}

/**
 * Assembled from fragments so that no file in this lane — this one included —
 * contains any of them as a contiguous string. A grep test that had to except
 * its own source is a grep test that can be argued with.
 */
const FORBIDDEN: readonly Forbidden[] = [
  { needle: FOREIGN_OWNER, why: "a hardcoded repository owner" },
  { needle: FOREIGN_REPO, why: "a hardcoded repository name" },
  {
    needle: ["pyt", "hon3"].join(""),
    why: "an interpreter dropped as a capability",
  },
  {
    needle: ["yar", "n "].join(""),
    why: "a source repository's root script alias; the bins are called with npx --no-install",
  },
  {
    needle: ["app", "s/"].join(""),
    why: "a source repository's directory layout",
  },
  {
    needle: ["@campaign", "foundry/"].join(""),
    why: "a source repository's scope",
  },
  { needle: ["nit", "ro"].join(""), why: "a source repository's framework" },
  {
    needle: ["$HOME", "/.waves"].join(""),
    why: "the shared log root; the root is per-repository",
  },
  {
    needle: ["~", "/.waves"].join(""),
    why: "the shared log root; the root is per-repository",
  },
  {
    needle: ["port 300", "0"].join(""),
    why: "a literal port; ports come from the overlay",
  },
  {
    needle: ["port 300", "1"].join(""),
    why: "a literal port; ports come from the overlay",
  },
  {
    needle: ["port 431", "7"].join(""),
    why: "a literal port; ports come from the overlay",
  },
  {
    needle: ["D18", "4"].join(""),
    why: "a source repository's decision id; a rule is stated as prose instead",
  },
];

/** Every file under `dir`, recursively, as a package-relative path. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(relative(PACKAGE_ROOT, full));
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * The test directories, walked whole. This list grows in the same commit that
 * adds a directory — a grep that silently stopped watching one would be worse
 * than one that never watched it.
 */
const OWN_DIRS: readonly string[] = [
  "__tests__/plan-review",
  "__tests__/sweep",
  "__tests__/merge-prs",
];

const files: readonly string[] = [
  ...OWNS,
  ...OWN_DIRS.flatMap((dir) => filesUnder(resolve(PACKAGE_ROOT, dir))),
];

describe("the forbidden list, over every file this lane owns", () => {
  test("the list this test walks is not empty, and every named file exists", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const file of OWNS) {
      expect(() => statSync(resolve(PACKAGE_ROOT, file)), file).not.toThrow();
    }
  });

  test("no owned file carries a forbidden string", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(resolve(PACKAGE_ROOT, file), "utf8");
      for (const { needle, why } of FORBIDDEN) {
        if (text.includes(needle)) offenders.push(`${file}: ${why}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("this test's own patterns are not present in any owned file, including this one", () => {
    // The assertion above is only worth as much as its own ability to fail, and
    // it can only fail if the patterns exist SOMEWHERE. They exist nowhere.
    const self = readFileSync(
      resolve(PACKAGE_ROOT, "__tests__/sweep/forbidden.test.ts"),
      "utf8",
    );
    for (const { needle } of FORBIDDEN) {
      expect(
        self.includes(needle),
        "the pattern is not spelled out in this file",
      ).toBe(false);
    }
  });

  test("the sweep source names no repository of its own, in the query or in a default", () => {
    // The narrowest form of the check above, pointed at the one file where a
    // hardcoded repository did the most damage.
    for (const file of ["src/sweep/lib/sweep.ts", "src/sweep/lib/types.ts"]) {
      const text = readFileSync(resolve(PACKAGE_ROOT, file), "utf8");
      expect(text.includes('repository(owner: "'), file).toBe(false);
    }
  });
});
