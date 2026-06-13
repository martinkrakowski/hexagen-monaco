/**
 * findWorkspaceRoot contract (Wave-C consumer experience, RCA #7).
 *
 * Resolution order: `options.targetRoot` wins unconditionally; otherwise the
 * first probe start whose upward walk finds a package.json with a
 * `workspaces` ARRAY. The production default probes cwd FIRST, then the
 * installed module's __dirname — cwd-first is what makes a global/npx install
 * work at all (its __dirname lives in a cache directory whose walk-up finds
 * nothing; the old __dirname-only walk hard-failed there), and the __dirname
 * fallback preserves a locally-installed CLI invoked from OUTSIDE its
 * workspace. `probeStarts` is parameterized here so the cases pin the ORDER
 * and the fallback without depending on the test runner's actual cwd.
 *
 * The contract suites pin the spawned-CLI behaviour end-to-end (published
 * layout, cwd = fixture root); these unit cases pin the walk itself.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findWorkspaceRoot } from "../src/sync-engine-init.js";

async function withTempTree(fn: (base: string) => Promise<void>) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-root-test-"));
  try {
    await fn(base);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

/** A directory whose package.json declares a workspaces ARRAY (a real root). */
async function makeWorkspaceRoot(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: path.basename(dir), workspaces: ["packages/*"] }) +
      "\n",
    "utf8",
  );
}

describe("findWorkspaceRoot (cwd-first probe order, RCA #7)", () => {
  it("targetRoot wins without consulting any probe", async () => {
    // Empty probe list: if targetRoot did not return first, the loop would
    // fall through to the throw below — so a resolved value proves the probes
    // were never needed.
    const root = await findWorkspaceRoot({ targetRoot: "/explicit/root" }, []);
    assert.strictEqual(root, "/explicit/root");
  });

  it("the FIRST probe with a workspaces root wins (cwd beats install location)", async () => {
    await withTempTree(async (base) => {
      const consumerRoot = path.join(base, "consumer");
      const installRoot = path.join(base, "install");
      await makeWorkspaceRoot(consumerRoot);
      await makeWorkspaceRoot(installRoot);
      const cwdDeep = path.join(consumerRoot, "packages", "app", "src");
      const dirnameDeep = path.join(installRoot, "node_modules", "cli", "dist");
      await fs.mkdir(cwdDeep, { recursive: true });
      await fs.mkdir(dirnameDeep, { recursive: true });

      const root = await findWorkspaceRoot({}, [cwdDeep, dirnameDeep]);
      assert.strictEqual(
        root,
        consumerRoot,
        "the cwd-position probe must win over the install-position probe",
      );
    });
  });

  it("falls back to the next probe when the first walk finds nothing (local install run from outside)", async () => {
    await withTempTree(async (base) => {
      const installRoot = path.join(base, "install");
      await makeWorkspaceRoot(installRoot);
      const dirnameDeep = path.join(installRoot, "node_modules", "cli", "dist");
      await fs.mkdir(dirnameDeep, { recursive: true });
      // The no-hit probe carries a package.json WITHOUT workspaces — proving
      // both that a bare package.json is not a root and that the walk moves
      // on to the fallback. (Its tmpdir ancestors carry no workspaces
      // package.json either — same environmental assumption the contract
      // fixtures already rely on.)
      const outside = path.join(base, "elsewhere");
      await fs.mkdir(outside, { recursive: true });
      await fs.writeFile(
        path.join(outside, "package.json"),
        JSON.stringify({ name: "not-a-root" }) + "\n",
        "utf8",
      );

      const root = await findWorkspaceRoot({}, [outside, dirnameDeep]);
      assert.strictEqual(
        root,
        installRoot,
        "the __dirname-position fallback must preserve the locally-installed setup",
      );
    });
  });

  it("the NEAREST enclosing root wins within one walk (nested workspaces)", async () => {
    await withTempTree(async (base) => {
      const outer = path.join(base, "outer");
      const inner = path.join(outer, "vendor", "inner");
      await makeWorkspaceRoot(outer);
      await makeWorkspaceRoot(inner);
      const deep = path.join(inner, "packages", "lib");
      await fs.mkdir(deep, { recursive: true });

      const root = await findWorkspaceRoot({}, [deep]);
      assert.strictEqual(root, inner, "walk-up stops at the first hit");
    });
  });

  it("a non-array `workspaces` (yarn-classic object form) is walked past, not matched", async () => {
    await withTempTree(async (base) => {
      const objectFormRoot = path.join(base, "object-form");
      await fs.mkdir(path.join(objectFormRoot, "nested"), { recursive: true });
      await fs.writeFile(
        path.join(objectFormRoot, "package.json"),
        JSON.stringify({
          name: "object-form",
          workspaces: { packages: ["packages/*"] },
        }) + "\n",
        "utf8",
      );
      const realRoot = path.join(base, "real");
      await makeWorkspaceRoot(realRoot);

      const root = await findWorkspaceRoot({}, [
        path.join(objectFormRoot, "nested"),
        realRoot,
      ]);
      assert.strictEqual(
        root,
        realRoot,
        "only a workspaces ARRAY marks a root (existing semantics, now pinned)",
      );
    });
  });

  it("exhausted probes throw the rich error naming every probe and the npx/global footgun", async () => {
    await withTempTree(async (base) => {
      const nowhere = path.join(base, "nowhere");
      await fs.mkdir(nowhere, { recursive: true });

      await assert.rejects(findWorkspaceRoot({}, [nowhere]), (err: Error) => {
        assert.match(
          err.message,
          /no package\.json with a "workspaces" array/,
          "must say WHAT was searched for",
        );
        assert.ok(
          err.message.includes(nowhere),
          "must name the probe paths actually walked",
        );
        assert.match(
          err.message,
          /globally- or npx-installed CLI can only resolve the root from your\s+current directory/,
          "must name the npx/global footgun — the terse pre-Wave-C error never did",
        );
        return true;
      });
    });
  });

  it("threads a non-ENOENT obstacle (malformed package.json) into the exhausted-walk error", async () => {
    await withTempTree(async (base) => {
      const broken = path.join(base, "broken");
      await fs.mkdir(broken, { recursive: true });
      // A package.json that EXISTS but cannot be parsed: the pre-fix blanket
      // catch swallowed this, so the walk died saying only "no workspaces
      // array" — misdirecting the user away from the real cause. ENOENT (no
      // package.json) still stays silent; this obstacle must now surface.
      await fs.writeFile(
        path.join(broken, "package.json"),
        "{ not: valid json",
        "utf8",
      );

      await assert.rejects(findWorkspaceRoot({}, [broken]), (err: Error) => {
        assert.match(
          err.message,
          /could not be read or parsed/,
          "the exhausted-walk error must report the real obstacle",
        );
        assert.ok(
          err.message.includes(path.join(broken, "package.json")),
          "the failing package.json path must be named",
        );
        return true;
      });
    });
  });

  it("recovers a valid root above a malformed package.json (a low obstacle doesn't blind the walk)", async () => {
    await withTempTree(async (base) => {
      // A real workspaces root HIGH, a malformed package.json LOW. The walk
      // records the obstacle (B4) but must keep ascending and return the root
      // above it — a non-ENOENT error must never blind the resolver to a valid
      // root higher up, or a single unreadable nested package.json would break
      // resolution for the whole tree.
      const root = path.join(base, "ws");
      await makeWorkspaceRoot(root);
      const broken = path.join(root, "packages", "broken");
      await fs.mkdir(broken, { recursive: true });
      await fs.writeFile(
        path.join(broken, "package.json"),
        "{ not: valid json",
        "utf8",
      );
      const deep = path.join(broken, "src", "app");
      await fs.mkdir(deep, { recursive: true });

      const resolved = await findWorkspaceRoot({}, [deep]);
      assert.strictEqual(
        resolved,
        root,
        "the walk must bypass the malformed package.json and return the valid root above it",
      );
    });
  });
});
