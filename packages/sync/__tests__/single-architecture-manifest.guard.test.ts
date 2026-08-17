import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-wide guard: this monorepo has exactly ONE `.architecture/manifest.yaml`,
 * at the repository root.
 *
 * Why this exists. `packages/ui/.architecture/manifest.yaml` was a tracked
 * 806-line copy of the WHOLE-REPO manifest — `system: hexagen-monaco`,
 * `workspaces: [apps/*, packages/*]` — sitting inside a single package. It was
 * an orphaned artifact of an external-mode sync whose `workspaceRoot` was
 * `packages/ui` (see `writeManifestIfFreshExternal` in
 * `src/generators/architecture-files.ts`, which materialises a bootstrap
 * manifest at the target root), swept into the tree wholesale with the commit
 * that created the package.
 *
 * It was not inert. `tools/arch-linter/src/cli.ts` discovers its project root by
 * walking UP from `cwd()` looking for exactly this path, so the copy HIJACKED
 * that discovery: running the linter from `packages/ui` resolved ROOT_DIR to
 * `packages/ui` and died on the stale file instead of linting the repo. A
 * second manifest is therefore a live root-resolution hazard, not just
 * duplicated text.
 *
 * And it rotted, as duplicates do. By the time it was removed it still listed
 * the deleted `api-gateway` workspace, still carried the pre-ADR-0048 port
 * directions that #506 was correcting in the real contexts, still named
 * `ProjectGeneratorPort` (removed by #488), and — worst — still carried ~35
 * entity/port/adapter names that commit `0872a65f` ("remove aspirational
 * drift") had deliberately purged from the real manifest months earlier. A
 * stale duplicate of the central architectural document does not just go
 * unread; it re-teaches the next reader (or agent) exactly the drift the repo
 * already paid to remove.
 *
 * A convention nothing enforces is how the copy survived in the first place —
 * the same reasoning as `no-jest-residue.guard.test.ts` next door. This is the
 * checked form.
 *
 * Scope note: this asserts there is exactly one manifest and that it is at the
 * root. It says nothing about the manifest's CONTENT — the arch-linter and its
 * schema own that, and conflating the two would make one failure report two
 * unrelated fixes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** The one true location, repo-relative and POSIX-separated. */
const CANONICAL = ".architecture/manifest.yaml";

/**
 * Directories the walk never enters.
 *
 * `node_modules` is load-bearing: published HexaGen packages and generated
 * fixtures legitimately ship their own `.architecture/manifest.yaml`, and
 * matching those would make this guard permanently red for reasons no one can
 * fix from this tree. Build outputs (`dist`, `dist-test`, `.next`, `.turbo`,
 * `coverage`) are derived — a hit inside them is a stale artifact, not a source
 * fact.
 *
 * `.claude` is skipped because agent worktrees are checked out beneath it: from
 * a primary checkout the walk would otherwise descend into every parallel
 * worktree and report ITS second manifest as this tree's, which is both wrong
 * and unfixable from here. (Mirrors the same exclusion in
 * `no-jest-residue.guard.test.ts`.)
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
]);

const rel = (absolute: string) =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join("/");

/**
 * Every `<dir>/.architecture/manifest.yaml` in the tree.
 *
 * Matched on the EXACT filename. `.architecture/manifest.yaml.pre-split-backup`
 * is a deliberate artifact of the `manifest split` command and must not be
 * caught by a prefix match — it is a backup, not a second source of truth.
 */
async function findArchitectureManifests(): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // An unreadable directory is a directory this guard is not checking, but
      // it is not evidence of a violation either. The anchor test below is what
      // catches a walk that reaches too little to mean anything.
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (
        entry.name === "manifest.yaml" &&
        path.basename(dir) === ".architecture"
      ) {
        found.push(absolute);
      }
    }
  };
  await visit(REPO_ROOT);
  return found.map(rel).sort();
}

/** One traversal per run, shared by the assertions below. */
let discovery: Promise<string[]> | undefined;
const walk = (): Promise<string[]> =>
  (discovery ??= findArchitectureManifests());

describe("exactly one .architecture/manifest.yaml", () => {
  it("discovery reaches the whole repo", async () => {
    // An anchor, not a magic number: if the walk cannot see the root manifest
    // it is rooted somewhere unexpected, and the assertion below would pass
    // vacuously while checking nothing.
    const manifests = await walk();
    assert.ok(
      manifests.includes(CANONICAL),
      `walk did not reach ${CANONICAL} from ${REPO_ROOT} — the guard is ` +
        `rooted wrong and is checking nothing. Found: ${manifests.join(", ")}`,
    );
  });

  it("no package carries its own copy of the repo manifest", async () => {
    const manifests = await walk();
    assert.deepEqual(
      manifests,
      [CANONICAL],
      `The monorepo has exactly one architectural manifest, at ${CANONICAL}.\n\n` +
        `A second one is not a harmless duplicate:\n` +
        `  1. tools/arch-linter/src/cli.ts finds its project root by walking UP\n` +
        `     from cwd for '.architecture/manifest.yaml'. A copy inside a package\n` +
        `     captures that walk, so running the linter from anywhere beneath it\n` +
        `     lints (or fails on) the copy instead of the repo.\n` +
        `  2. It drifts silently, and a stale copy of the central architectural\n` +
        `     document mis-teaches whoever reads it next.\n\n` +
        `If this fired after a sync run, the run had the wrong workspaceRoot:\n` +
        `external mode writes a bootstrap manifest at its target root (see\n` +
        `writeManifestIfFreshExternal in src/generators/architecture-files.ts).\n` +
        `Delete the copy — do not edit it into agreement with the root.\n\n` +
        `Found:\n` +
        manifests.map((m) => `  - ${m}`).join("\n"),
    );
  });

  /**
   * The matcher is the whole guard; a gap in it is invisible, because the suite
   * would stay green while checking less. The repo's current (clean) state
   * cannot demonstrate a detection that does not exist, so the discriminations
   * that matter are exercised directly.
   */
  it("matches the manifest filename exactly, sparing the split backup", async () => {
    const manifests = await walk();

    // The backup that `manifest split` leaves behind is real and lives right
    // next to the canonical file. A prefix/glob match would flag it forever.
    const backup = path.join(
      REPO_ROOT,
      ".architecture",
      "manifest.yaml.pre-split-backup",
    );
    const backupExists = await fs
      .access(backup)
      .then(() => true)
      .catch(() => false);
    if (backupExists) {
      assert.ok(
        !manifests.includes(`${CANONICAL}.pre-split-backup`),
        "the pre-split backup is a deliberate artifact and must not be " +
          "reported as a second manifest",
      );
    }

    // A `manifest.yaml` that is NOT inside a directory named `.architecture`
    // is some other tool's file and none of this guard's business — the
    // directory name is half the match, and dropping it would flag unrelated
    // files across the repo.
    assert.ok(
      manifests.every((m) => m.endsWith(`/${CANONICAL}`) || m === CANONICAL),
      `matched a path outside a .architecture/ directory: ${manifests.join(", ")}`,
    );
  });
});
