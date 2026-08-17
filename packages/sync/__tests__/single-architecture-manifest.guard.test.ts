import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs, type Dirent } from "node:fs";
import os from "node:os";
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
 *
 * This list is the ONLY way a directory goes unscanned. Everything else must be
 * readable — see `findArchitectureManifests`.
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

/**
 * How a directory is listed. Injectable for one reason only: the failure policy
 * below is about unreadable directories, and "unreadable" is a permission fact
 * that does not reproduce identically everywhere (a `chmod 000` denies nothing
 * to a root-owned CI container). Injecting the reader pins the POLICY the same
 * way on every machine; `findArchitectureManifests` is exercised against the
 * real filesystem by every other test in this file.
 */
type ReadDirectory = (dir: string) => Promise<Dirent[]>;

const readDirectory: ReadDirectory = (dir) =>
  fs.readdir(dir, { withFileTypes: true });

/**
 * Every `<dir>/.architecture/manifest.yaml` beneath `root`.
 *
 * Matched on the EXACT filename. `.architecture/manifest.yaml.pre-split-backup`
 * is a deliberate artifact of the `manifest split` command and must not be
 * caught by a prefix match — it is a backup, not a second source of truth.
 *
 * An unreadable directory REJECTS. This is the whole reliability contract of
 * the guard, so it is worth stating why: a walk that swallows a `readdir`
 * failure and returns nothing for that subtree does not report "no manifest
 * here", it reports "I did not look" — in the same shape. The suite then goes
 * green over a partial scan while a second manifest sits inside the subtree
 * that was skipped, which is precisely the vacuous pass this guard exists to
 * prevent. The anchor test below cannot cover for it either: the anchor only
 * proves the ROOT was reachable, and the root stays readable while any other
 * subtree is not.
 *
 * Nothing is quietly tolerated, not even ENOENT: with symlinks never traversed
 * and build/vendor trees excluded by name, every remaining directory here is a
 * real source directory that the checkout is expected to be able to read. A
 * directory that legitimately must not be entered belongs in `SKIP_DIRS`, with
 * a reason, where the exclusion is visible.
 */
async function findArchitectureManifests(
  root: string,
  readDir: ReadDirectory = readDirectory,
): Promise<string[]> {
  const found: string[] = [];
  const relative = (absolute: string) =>
    path.relative(root, absolute).split(path.sep).join("/") || ".";

  const visit = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readDir(dir);
    } catch (cause) {
      const code =
        (cause as NodeJS.ErrnoException | undefined)?.code ?? "unknown error";
      throw new Error(
        `Could not read '${relative(dir)}' (${code}) while searching for ` +
          `architecture manifests under ${root}.\n\n` +
          `An unreadable directory is not an empty one. Treating it as empty ` +
          `would let this guard pass while never scanning that subtree — a ` +
          `second manifest inside it would go unreported, which is the exact ` +
          `failure the guard is here to catch. Make the directory readable, ` +
          `or add it to SKIP_DIRS with a reason so the exclusion is visible.`,
        { cause },
      );
    }

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(absolute);
        continue;
      }
      // Symlinks are deliberately not followed: `isDirectory()` is false for
      // them, so they are neither traversed nor matched.
      if (!entry.isFile()) continue;
      if (
        entry.name === "manifest.yaml" &&
        path.basename(dir) === ".architecture"
      ) {
        found.push(absolute);
      }
    }
  };

  await visit(root);
  return found.map(relative).sort();
}

/** One traversal per run, shared by the assertions below. */
let discovery: Promise<string[]> | undefined;
const walk = (): Promise<string[]> =>
  (discovery ??= findArchitectureManifests(REPO_ROOT));

describe("exactly one .architecture/manifest.yaml", () => {
  it("discovery reaches the whole repo", async () => {
    // An anchor, not a magic number: if the walk cannot see the root manifest
    // it is rooted somewhere unexpected, and the assertion below would pass
    // vacuously while checking nothing.
    //
    // Note what this does NOT cover: the root manifest stays visible while any
    // OTHER subtree is unreadable, so a partial scan sails past this assertion.
    // Fail-closed traversal in `findArchitectureManifests` is what covers that.
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
    // Only "the file is not there" means absent. A permission or IO error here
    // is not evidence of absence, and swallowing it would silently skip the
    // assertion below — the same shape of quiet degradation the traversal
    // above refuses.
    const backupExists = await fs
      .access(backup)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
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

/**
 * The traversal's own behaviour, on throwaway fixtures under `os.tmpdir()`
 * (never inside the repo, so these can never perturb the assertions above).
 *
 * The guard's value is entirely in what its walk can still see, and the repo's
 * clean state proves neither the detection nor the failure policy: a walk that
 * found nothing and a walk that looked nowhere are the same green.
 */
describe("the manifest walk", () => {
  const withFixture = async (
    build: (root: string) => Promise<void>,
    assertOn: (root: string) => Promise<void>,
  ) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "single-manifest-guard-"),
    );
    try {
      await build(root);
      await assertOn(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  };

  const writeManifest = async (root: string, ...segments: string[]) => {
    const dir = path.join(root, ...segments, ".architecture");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "manifest.yaml"), "system: fixture\n");
  };

  it("finds a nested copy, spares the split backup, and skips node_modules", async () => {
    await withFixture(
      async (root) => {
        await writeManifest(root);
        await writeManifest(root, "packages", "ui");
        await fs.writeFile(
          path.join(root, ".architecture", "manifest.yaml.pre-split-backup"),
          "system: fixture-backup\n",
        );
        // A published package inside node_modules legitimately ships one.
        await writeManifest(root, "node_modules", "@hexagen", "sync");
      },
      async (root) => {
        assert.deepEqual(await findArchitectureManifests(root), [
          ".architecture/manifest.yaml",
          "packages/ui/.architecture/manifest.yaml",
        ]);
      },
    );
  });

  it("rejects on an unreadable subtree instead of reporting a partial scan", async () => {
    await withFixture(
      async (root) => {
        await writeManifest(root);
        // The duplicate hides inside the subtree that cannot be read. A
        // swallowing walk returns the single root manifest here and the suite
        // goes green over a repo that has two.
        await writeManifest(root, "sealed");
      },
      async (root) => {
        const denied: NodeJS.ErrnoException = Object.assign(
          new Error(`EACCES: permission denied, scandir '${root}/sealed'`),
          { code: "EACCES" },
        );
        const readDir: ReadDirectory = async (dir) =>
          path.basename(dir) === "sealed"
            ? Promise.reject(denied)
            : fs.readdir(dir, { withFileTypes: true });

        await assert.rejects(
          findArchitectureManifests(root, readDir),
          (error: Error) => {
            assert.match(error.message, /sealed/);
            assert.match(error.message, /EACCES/);
            return true;
          },
          "an unreadable directory must fail the walk, not shrink its result",
        );
      },
    );
  });

  it("rejects on a real filesystem error rather than returning empty", async () => {
    // The same policy, with no injection involved: a genuine errno from the
    // real `fs.readdir` must surface instead of producing an empty result that
    // reads exactly like a clean repo.
    await withFixture(
      async () => {},
      async (root) => {
        const missing = path.join(root, "does-not-exist");
        await assert.rejects(
          findArchitectureManifests(missing),
          (error: Error) => {
            assert.match(error.message, /ENOENT/);
            assert.equal(
              (error.cause as NodeJS.ErrnoException).code,
              "ENOENT",
              "the originating errno must stay attached as the cause",
            );
            return true;
          },
        );
      },
    );
  });
});
