import { describe, it } from "vitest";
import assert from "node:assert";
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

/** Major version from a semver range spec (`^6.0.3` -> 6, `>=5.4 <6` -> 5). */
function majorOf(spec: string): number {
  const match = spec.match(/(\d+)\./);
  assert.ok(match, `could not parse a major version from "${spec}"`);
  return Number(match[1]);
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
      majorOf(ownSpec) <= majorOf(rootSpec),
      `agentic-interaction pins typescript ${ownSpec} (major ${majorOf(
        ownSpec,
      )}), ahead of the root's ${rootSpec} (major ${majorOf(
        rootSpec,
      )}). Remove the stray pin so this package uses the monorepo TypeScript (plan item 3.1).`,
    );
  });
});
