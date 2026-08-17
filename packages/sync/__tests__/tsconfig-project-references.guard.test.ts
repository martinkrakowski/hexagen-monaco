import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-wide guard: `tsconfig.base.json`'s `references` array is exactly the set
 * of `packages/*` workspaces — no orphans, no danglers.
 *
 * WHY THIS EXISTS. HEX-035 found the array had silently omitted six workspaces
 * that existed on disk. It drifted because NOTHING READS IT. Turbo runs a
 * per-package `tsc` / `tsc --noEmit`, each resolving its own tsconfig's own
 * `references`; the arch-linter hands the file to ts-morph purely for compiler
 * options and glob discovery. The root array is never executed by any command,
 * so a missing entry cannot fail a build and a stale entry cannot fail a build
 * either. `tsc -b tsconfig.base.json` is not the missing command: this file is
 * an *options base* (`rootDir: "./src"`, no `files`/`include`), so loading it as
 * a project falls back to TypeScript's default include — every file under the
 * repo root — and reports TS6059 for thousands of them. It is a declaration of
 * the project graph, and a declaration that no tool checks is a comment. This
 * test is the tool.
 *
 * SCOPE — why `packages/*` and not every workspace. ADR-0050 §4 records that the
 * array "covers `packages/*` only", and that the arch-linter's config divergence
 * is therefore an arch-linter change and not a base-references edit. The two
 * non-`packages` groups are excluded for reasons that predate this guard:
 *
 *   - `apps/*`   — `apps/web` is a Next.js app compiled by `next build`, not by
 *                  the TypeScript solution; `apps/tui` is a leaf consumer that
 *                  nothing in `packages/` references back.
 *   - `tools/*`  — `tools/arch-linter` is bundled by tsup and resolves
 *                  `composite: false`, so it is not a valid reference target.
 *
 * That exclusion is asserted below rather than assumed: a NEW workspace group in
 * root `package.json` fails this test until someone decides which side it is on,
 * so the scope stays a decision instead of decaying into an oversight.
 *
 * WHAT THIS DOES NOT CLAIM. Membership only. It does not assert the references
 * are ordered, that each target is `composite`, or that the graph builds — those
 * are separate failures with separate fixes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** The workspace group whose members must all appear in `references`. */
const REFERENCED_GROUP = "packages";

/**
 * Groups deliberately kept OUT of the root reference graph. Widening this set is
 * a decision, not a fix: everything listed here is a workspace whose TypeScript
 * is compiled by something other than the solution graph.
 */
const EXCLUDED_GROUPS = new Set(["apps", "tools"]);

/**
 * Workspace globs, read from the root `package.json` — the single source of
 * truth. Mirroring them here would let a newly added pattern be skipped
 * silently, which in a completeness guard is the worst failure mode: it keeps
 * passing while checking less.
 */
async function workspaceGroups(): Promise<string[]> {
  const raw = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const patterns = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : (pkg.workspaces?.packages ?? []);
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
  return patterns.map((p) => p.slice(0, -2));
}

/** The errno of a Node filesystem error, or `undefined` if it carries none. */
function errnoOf(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The only errnos that legitimately mean "there is no manifest here, so this is
 * not a workspace". Every other failure means discovery was DEGRADED, not that
 * the directory was judged — see the fail-closed note in `workspacesIn`.
 */
const ABSENT = new Set(["ENOENT", "ENOTDIR"]);

/** Repo-relative directories of every workspace under `group/`. */
async function workspacesIn(group: string): Promise<string[]> {
  const groupDir = path.join(REPO_ROOT, group);
  let entries: string[];
  try {
    entries = await fs.readdir(groupDir);
  } catch (err) {
    assert.fail(
      `workspace pattern "${group}/*" points at ${group}/, which could not be ` +
        `read (${errnoOf(err) ?? "no errno"}): ${String(err)}`,
    );
  }
  const found: string[] = [];
  for (const entry of entries) {
    const manifest = path.join(groupDir, entry, "package.json");
    try {
      await fs.access(manifest);
    } catch (err) {
      // FAIL CLOSED. Only absence means "stray directory". Any other errno
      // (EACCES, EIO, ELOOP…) means we could not tell — and treating "could not
      // tell" as "not a workspace" drops the directory from `expected`, which
      // makes an UNREFERENCED workspace vanish from `missing` and turns this
      // guard green on exactly the drift it exists to catch. A completeness
      // guard that silently checks less is worse than one that stops.
      const code = errnoOf(err);
      assert.ok(
        code !== undefined && ABSENT.has(code),
        `could not determine whether ${group}/${entry} is a workspace: ` +
          `${code ?? "no errno"} reading ${group}/${entry}/package.json. ` +
          `Skipping it would drop it from the expected set and let this guard ` +
          `pass on an incomplete scan (${String(err)}).`,
      );
      continue; // stray directory, not a workspace
    }
    found.push(`${group}/${entry}`);
  }
  assert.ok(
    found.length > 0,
    `workspace pattern "${group}/*" matched no packages — either it is dead ` +
      `and should be removed from root package.json, or discovery is broken`,
  );
  return found.sort();
}

/** `references` paths from `tsconfig.base.json`, normalised to `group/name`. */
async function declaredReferences(): Promise<string[]> {
  const raw = await fs.readFile(
    path.join(REPO_ROOT, "tsconfig.base.json"),
    "utf8",
  );
  const cfg = JSON.parse(raw) as { references?: { path?: string }[] };
  const refs = cfg.references ?? [];
  assert.ok(
    refs.length > 0,
    "tsconfig.base.json declares no references — this guard would compare " +
      "against an empty set and pass vacuously",
  );
  return refs.map((r) => {
    assert.ok(
      typeof r.path === "string" && r.path.length > 0,
      `tsconfig.base.json reference entry has no "path": ${JSON.stringify(r)}`,
    );
    return r.path!.replace(/^\.\//, "").replace(/\/+$/, "");
  });
}

describe("tsconfig.base.json project references", () => {
  it("declares every packages/* workspace, and only real ones", async () => {
    const references = await declaredReferences();
    const expected = await workspacesIn(REFERENCED_GROUP);

    // Anti-vacuity. Both sides must be non-trivially populated AND must contain
    // this guard's own home, so a discovery bug that returns an empty or bogus
    // set fails here instead of producing a green "no differences".
    assert.ok(
      expected.includes(`${REFERENCED_GROUP}/sync`),
      `discovery did not find ${REFERENCED_GROUP}/sync, the package this guard ` +
        `lives in — found ${expected.length}: ${expected.join(", ")}`,
    );
    assert.ok(
      references.includes(`${REFERENCED_GROUP}/sync`),
      `tsconfig.base.json does not reference ${REFERENCED_GROUP}/sync, the ` +
        `package this guard lives in — the parse produced ${references.length} ` +
        `entries: ${references.join(", ")}`,
    );

    const duplicates = references.filter((r, i) => references.indexOf(r) !== i);
    assert.deepEqual(
      duplicates,
      [],
      `tsconfig.base.json references the same project more than once: ${duplicates.join(", ")}`,
    );

    const missing = expected.filter((w) => !references.includes(w));
    const dangling = references.filter((r) => !expected.includes(r));

    assert.deepEqual(
      { missing, dangling },
      { missing: [], dangling: [] },
      `tsconfig.base.json references must equal the ${REFERENCED_GROUP}/* workspace set.\n` +
        `Nothing executes this array, so drift here is invisible to every build ` +
        `command — that is exactly why it is asserted (HEX-035).\n\n` +
        (missing.length
          ? `  Missing (workspace exists, not referenced):\n` +
            missing.map((m) => `    - ${m}`).join("\n") +
            "\n"
          : "") +
        (dangling.length
          ? `  Dangling (referenced, no such workspace):\n` +
            dangling.map((d) => `    - ${d}`).join("\n") +
            "\n"
          : ""),
    );
  });

  it("every referenced project directory has a tsconfig.json", async () => {
    const references = await declaredReferences();
    // This loop already fails closed — an unreadable target lands in `broken`
    // like a missing one. It records the errno only so the report says why,
    // rather than calling an EACCES a missing file.
    const broken: string[] = [];
    for (const ref of references) {
      try {
        await fs.access(path.join(REPO_ROOT, ref, "tsconfig.json"));
      } catch (err) {
        const code = errnoOf(err);
        broken.push(
          ABSENT.has(code ?? "")
            ? `${ref}/tsconfig.json is missing`
            : `${ref}/tsconfig.json could not be read (${code ?? "no errno"})`,
        );
      }
    }
    assert.deepEqual(
      broken,
      [],
      `A project reference must point at a directory containing a tsconfig.json:\n` +
        broken.map((b) => `  - ${b}`).join("\n"),
    );
  });

  it("every workspace group is either referenced or explicitly excluded", async () => {
    const groups = await workspaceGroups();
    assert.ok(
      groups.includes(REFERENCED_GROUP),
      `root package.json no longer declares a "${REFERENCED_GROUP}/*" workspace ` +
        `pattern — found: ${groups.join(", ")}. This guard's subject is gone; ` +
        `retarget it rather than letting it pass on an empty comparison.`,
    );
    const undecided = groups.filter(
      (g) => g !== REFERENCED_GROUP && !EXCLUDED_GROUPS.has(g),
    );
    assert.deepEqual(
      undecided,
      [],
      `New workspace group(s) with no reference-graph decision: ${undecided.join(", ")}.\n` +
        `Either add their workspaces to tsconfig.base.json references, or add the ` +
        `group to EXCLUDED_GROUPS in this file with the reason it is compiled ` +
        `outside the solution graph (see ADR-0050 §4).`,
    );
  });
});
