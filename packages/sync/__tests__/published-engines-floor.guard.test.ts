import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagePublishedManifest } from "./helpers/stage-publish-package.js";

/**
 * Repo-wide guard: the published packages advertise the Node floor the repo
 * actually builds and tests against — and nothing silently drops that field on
 * the way to npm.
 *
 * Why this exists (ADR-0052 / MOD-004). Both published packages declared
 * `engines.node: ">=20"` while every CI leg provisions Node 22 (`capstone.yml`
 * and `sync-integrity.yml` pin 22.7, `publish.yml` pins 22.12.0) and the root
 * manifest declares `>=22.7.0`. Nothing ever exercised Node 20, so the published
 * contract was a fiction: an advertised support guarantee the pipeline never
 * backed. ADR-0052 aligns the two published manifests with the root floor.
 *
 * `engines` is metadata, so nothing fails when it drifts — which is exactly why
 * it drifted. This guard is the thing that fails.
 *
 * Three invariants, deliberately separate:
 *   1. Root declares the ADR floor. Every other check derives from root, so a
 *      silent root edit would otherwise re-point the whole guard.
 *   2. Every PUBLISHED package declares exactly that floor. Discovered from
 *      `publish.yml`, not hard-coded, so a third published package cannot be
 *      added outside the guard's view.
 *   3. No workspace declares a DIFFERENT floor. This is a drift check, not a
 *      completeness one: ADR-0052 scopes the fix to the published manifests and
 *      does not require private workspaces to declare `engines` at all, so a
 *      workspace with no `engines` field is fine and one that disagrees is not.
 *
 * Plus the publish-transform half of ADR-0052 Decision 2: a corrected source
 * value is only worth something if `prepare-publish-package.js` still carries
 * the field through verbatim — checked by running that transform over a
 * throwaway fixture, not by reading its source text.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** The floor ADR-0052 selected. Stated once, literally, on purpose. */
const ADR_0052_NODE_FLOOR = ">=22.7.0";

type Manifest = {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
  engines?: { node?: string };
};

async function readManifest(relDir: string): Promise<Manifest> {
  const raw = await fs.readFile(
    path.join(REPO_ROOT, relDir, "package.json"),
    "utf8",
  );
  return JSON.parse(raw) as Manifest;
}

/**
 * The workspace directories the release workflow actually publishes, read from
 * the `prepare-publish-package.js <dir>` staging steps in `publish.yml`.
 *
 * Read rather than listed: a hard-coded pair here would be a second source of
 * truth, and the failure mode of a completeness guard that drifts is that it
 * keeps passing while checking less. Adding a third published package to the
 * workflow enrols it in this guard automatically.
 */
async function publishedWorkspaceDirs(): Promise<string[]> {
  const workflowPath = path.join(REPO_ROOT, ".github/workflows/publish.yml");
  const raw = await fs.readFile(workflowPath, "utf8");
  // Match against executable lines only. Several comments in publish.yml name
  // the staging script in prose, and a sentence like "prepare-publish-package.js
  // strips workspace: deps" otherwise yields a phantom staged dir ("strips")
  // that no manifest backs. Dropping comment lines keeps the derivation tied to
  // steps that actually run; the "> 0" assertion below still fails closed if
  // the real staging steps ever disappear.
  const executable = raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const dirs = [
    ...executable.matchAll(/prepare-publish-package\.js\s+([^\s"']+)/g),
  ].map((m) => m[1]);
  const unique = [...new Set(dirs)];
  assert.ok(
    unique.length > 0,
    `no "prepare-publish-package.js <dir>" staging steps found in ${path.relative(
      REPO_ROOT,
      workflowPath,
    )} — either publishing moved, or this guard now checks nothing`,
  );
  return unique;
}

/**
 * Every workspace directory, expanded from the root manifest's globs. Same
 * approach (and same rationale) as the workspace-tool-declaration guard: only
 * the `<dir>/*` shape this repo uses is supported, and an unrecognised pattern
 * throws rather than being skipped.
 */
async function workspaceDirs(): Promise<string[]> {
  const root = await readManifest(".");
  const patterns = Array.isArray(root.workspaces)
    ? root.workspaces
    : (root.workspaces?.packages ?? []);
  assert.ok(
    patterns.length > 0,
    "root package.json declares no workspaces — this guard would check nothing",
  );
  const unsupported = patterns.filter((p) => !/^[^/*]+\/\*$/.test(p));
  assert.deepEqual(
    unsupported,
    [],
    `Unsupported workspace pattern(s): ${unsupported.join(", ")}. ` +
      `This guard only expands "<dir>/*". Teach it the new shape rather than ` +
      `letting those workspaces go unchecked.`,
  );

  const dirs: string[] = [];
  for (const pattern of patterns) {
    const group = pattern.slice(0, -2);
    const entries = await fs.readdir(path.join(REPO_ROOT, group));
    const before = dirs.length;
    for (const entry of entries) {
      const rel = path.posix.join(group, entry);
      try {
        await fs.access(path.join(REPO_ROOT, rel, "package.json"));
      } catch {
        continue; // stray directory, not a workspace
      }
      dirs.push(rel);
    }
    assert.ok(
      dirs.length > before,
      `workspace pattern "${pattern}" matched no packages — either it is dead ` +
        `and should be removed from root package.json, or discovery is broken`,
    );
  }
  return dirs;
}

describe("published engines.node floor (ADR-0052)", () => {
  it("the root manifest declares the ADR-0052 Node floor", async () => {
    const root = await readManifest(".");
    assert.equal(
      root.engines?.node,
      ADR_0052_NODE_FLOOR,
      `Root engines.node must be "${ADR_0052_NODE_FLOOR}" (ADR-0052). The published ` +
        `packages are checked against this value, so changing it here silently ` +
        `re-points the whole guard. Lowering the floor requires a follow-up ADR that ` +
        `adds the compensating CI leg in the same change (ADR-0052 Decision 3).`,
    );
  });

  it("every published package declares exactly the root floor", async () => {
    const dirs = await publishedWorkspaceDirs();
    assert.ok(
      dirs.includes("packages/sync"),
      `publish.yml no longer stages packages/sync, the package this guard lives ` +
        `in — found: ${dirs.join(", ")}`,
    );

    const violations: string[] = [];
    for (const dir of dirs) {
      const pkg = await readManifest(dir);
      if (pkg.engines?.node !== ADR_0052_NODE_FLOOR) {
        violations.push(
          `${dir} (${pkg.name ?? "unnamed"}) declares engines.node ` +
            `${pkg.engines?.node === undefined ? "nothing" : `"${pkg.engines.node}"`}`,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Published packages must advertise the Node floor CI actually exercises ` +
        `("${ADR_0052_NODE_FLOOR}", ADR-0052).\n` +
        `A lower floor is a support claim no CI leg backs: the artifacts are built and\n` +
        `smoke-tested on Node 22 only (publish.yml pins 22.12.0, the rest of CI 22.7).\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });

  it("no workspace declares a Node floor that disagrees with the root", async () => {
    // Drift check, not a completeness check: ADR-0052 does not require private
    // workspaces to declare `engines`, so absence is fine — disagreement is not.
    const violations: string[] = [];
    for (const dir of await workspaceDirs()) {
      const declared = (await readManifest(dir)).engines?.node;
      if (declared !== undefined && declared !== ADR_0052_NODE_FLOOR) {
        violations.push(`${dir} declares engines.node "${declared}"`);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `A workspace that declares engines.node must declare the repo floor ` +
        `("${ADR_0052_NODE_FLOOR}").\n` +
        `Declaring nothing is fine; declaring a second, disagreeing floor is how the\n` +
        `published contract drifted in the first place (MOD-004).\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });

  it("the publish transform still carries engines through to npm", async () => {
    // ADR-0052 Decision 2: the source fix is sufficient ONLY because `engines`
    // rides the retained-fields whitelist verbatim. Dropping it from that list
    // would silently un-publish the floor while every source manifest still
    // looks correct — the exact failure this guard exists to catch.
    //
    // Asserted by RUNNING the transform, not by reading its source. A regex over
    // the `RETAINED_FIELDS` literal is satisfied by a commented-out `// "engines",`
    // — and broken by an unrelated reformat — so it can both false-pass and
    // false-fail. What the staged manifest actually contains cannot do either.
    const staged = await stagePublishedManifest(
      "@hexagen/engines-floor-fixture",
      {
        engines: { node: ADR_0052_NODE_FLOOR },
      },
    );
    assert.deepEqual(
      staged.engines,
      { node: ADR_0052_NODE_FLOOR },
      "scripts/prepare-publish-package.js dropped `engines` from the staged manifest.\n" +
        "The published packages would then advertise no Node floor at all, no matter\n" +
        "what the source manifests say (ADR-0052 Decision 2).",
    );
  });
});
