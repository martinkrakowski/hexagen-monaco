import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildTemplateBundle,
  discoverTemplateIds,
} from "../../src/infrastructure/build-template-bundle.js";

/**
 * Regression guard for the stray-directory shipping defect.
 *
 * Everything under templates/ reaches customers: it is copied verbatim into the
 * published CLI (packages/sync tsup onSuccess → dist/templates/) and inlined
 * into template-bundle.generated.ts. A `.greptile/` tooling directory added
 * under templates/ was caught only because an unrelated guard suite happened to
 * enumerate the directory more strictly and crashed on it first — the build
 * itself either bundled the stray (when it carried a manifest.json) or dropped
 * it silently (when it did not), and neither says anything.
 *
 * These tests fix the rule: a template is a kebab-case directory holding a
 * manifest.json; anything else under templates/ fails the build by name.
 */

let dir: string;

const MANIFEST = JSON.stringify({
  id: "placeholder",
  name: "Placeholder",
  description: "fixture",
  version: "1.0.0",
});

async function template(name: string, id = name): Promise<void> {
  await fs.mkdir(path.join(dir, name, "files"), { recursive: true });
  await fs.writeFile(
    path.join(dir, name, "manifest.json"),
    JSON.stringify({ ...JSON.parse(MANIFEST), id }),
    "utf-8",
  );
  await fs.writeFile(path.join(dir, name, "files", "a.txt"), "a\n", "utf-8");
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-templates-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("discoverTemplateIds", () => {
  it("returns kebab-case directories holding a manifest.json, sorted", async () => {
    await template("rate-limiting");
    await template("adobe-substance-3d");
    assert.deepStrictEqual(await discoverTemplateIds(dir), [
      "adobe-substance-3d",
      "rate-limiting",
    ]);
  });

  it("rejects a dot-directory that carries no manifest (the .greptile case), naming it", async () => {
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, ".greptile"));
    await fs.writeFile(path.join(dir, ".greptile", "config.yaml"), "x: 1\n");

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(err.message, /\.greptile/);
      assert.match(err.message, /not a kebab-case template id/);
      return true;
    });
  });

  it("rejects a dot-directory even when it carries a valid manifest", async () => {
    // The dangerous half: a manifest-only rule would have accepted this and
    // shipped it as a template id.
    await template("rate-limiting");
    await template(".probe-tooling", "probe");

    await assert.rejects(discoverTemplateIds(dir), /\.probe-tooling/);
  });

  it("rejects a non-dot stray directory with no manifest, naming it", async () => {
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, "scratch"));

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(err.message, /scratch — no manifest\.json/);
      return true;
    });
  });

  it("reports every stray at once, not just the first", async () => {
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, ".vscode"));
    await fs.mkdir(path.join(dir, "Scratch Copy"));

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(err.message, /\.vscode/);
      assert.match(err.message, /Scratch Copy/);
      assert.match(err.message, /2 entries/);
      return true;
    });
  });

  it("excludes the named reserved fixture without failing", async () => {
    await template("rate-limiting");
    await template("__example__", "__example__");

    assert.deepStrictEqual(await discoverTemplateIds(dir), ["rate-limiting"]);
  });

  it("rejects a __-prefixed directory that is not a known fixture", async () => {
    // The namespace-bypass hole: a `__` prefix must not be a way to opt out of
    // the check. templates/ is copied verbatim into the published CLI, so a
    // directory that skips validation skips straight into the tarball.
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, "__scratch"));
    await fs.writeFile(
      path.join(dir, "__scratch", "SHOULD_NEVER_SHIP.txt"),
      "payload\n",
    );

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(err.message, /__scratch/);
      assert.match(err.message, /not one of the known fixtures/);
      return true;
    });
  });

  it("rejects a __-prefixed stray even when it carries a valid manifest", async () => {
    await template("rate-limiting");
    await template("__scratch-copy", "scratch-copy");

    await assert.rejects(discoverTemplateIds(dir), /__scratch-copy/);
  });

  it("validates the reserved fixture too, rather than exempting it", async () => {
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, "__example__"));

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(err.message, /__example__ — no manifest\.json/);
      return true;
    });
  });

  it("rejects a directory whose manifest.json is itself a directory", async () => {
    // fs.stat() succeeds for a directory, so an existence-only check accepts
    // this and buildTemplateBundle then dies on EISDIR naming a path instead of
    // the mistake.
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, "weird-template", "manifest.json"), {
      recursive: true,
    });

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(
        err.message,
        /weird-template — manifest\.json is not a regular file/,
      );
      return true;
    });
  });

  it("rejects a manifest.json that is a symlink, under the same no-symlinks rule", async () => {
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, "linked-template", "files"), {
      recursive: true,
    });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "outside-"));
    await fs.writeFile(path.join(outside, "manifest.json"), MANIFEST, "utf-8");
    await fs.symlink(
      path.join(outside, "manifest.json"),
      path.join(dir, "linked-template", "manifest.json"),
    );

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(
        err.message,
        /linked-template — manifest\.json is not a regular file/,
      );
      return true;
    });

    await fs.rm(outside, { recursive: true, force: true });
  });

  it("reports a stray file, because a verbatim copy ships it", async () => {
    // Not "harmless because it cannot become a template id": packages/sync
    // cpSyncs templates/ into the published tarball, so a file ignored here is
    // a file shipped.
    await template("rate-limiting");
    await fs.writeFile(path.join(dir, "leftover-notes.md"), "notes\n", "utf-8");

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(
        err.message,
        /leftover-notes\.md — a file, not a template directory/,
      );
      return true;
    });
  });

  it("reports a symlink at the top level, which no other check would see", async () => {
    // A link can point anywhere, including outside templates/ entirely, so it
    // is content in the shipped directory that nothing here validates.
    await template("rate-limiting");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "outside-"));
    await fs.writeFile(path.join(outside, "manifest.json"), MANIFEST, "utf-8");
    await fs.symlink(outside, path.join(dir, "smuggled"));

    await assert.rejects(discoverTemplateIds(dir), (err: Error) => {
      assert.match(err.message, /smuggled — a symlink/);
      return true;
    });

    await fs.rm(outside, { recursive: true, force: true });
  });

  it("fails rather than passing vacuously when nothing is discovered", async () => {
    await assert.rejects(discoverTemplateIds(dir), /No templates discovered/);
  });
});

describe("buildTemplateBundle", () => {
  it("refuses to build a bundle while a stray directory sits in templates/", async () => {
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, ".greptile"));

    await assert.rejects(buildTemplateBundle(dir), /\.greptile/);
  });

  it("refuses to build while an unrecognised __-prefixed directory sits there", async () => {
    await template("rate-limiting");
    await fs.mkdir(path.join(dir, "__scratch"));

    await assert.rejects(buildTemplateBundle(dir), /__scratch/);
  });

  it("refuses to inline a symlink inside files/**, which the budget cannot measure", async () => {
    // readFile dereferences the link and inlines the target's bytes, while the
    // payload-budget guard lstats the link itself: measured 80 bytes against
    // 1_000_002 bundled. Rejecting the symlink is what keeps the two agreeing.
    await template("rate-limiting");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "outside-"));
    const big = path.join(outside, "big-payload.bin");
    await fs.writeFile(big, "X".repeat(1024), "utf-8");
    await fs.symlink(
      big,
      path.join(dir, "rate-limiting", "files", "linked.bin"),
    );

    await assert.rejects(buildTemplateBundle(dir), (err: Error) => {
      assert.match(err.message, /linked\.bin is a symlink/);
      return true;
    });

    await fs.rm(outside, { recursive: true, force: true });
  });

  it("bundles the discovered templates when the directory is clean", async () => {
    await template("rate-limiting");
    const bundle = await buildTemplateBundle(dir);

    assert.deepStrictEqual(
      bundle.manifests.map((m) => m.id),
      ["rate-limiting"],
    );
    assert.deepStrictEqual(Object.keys(bundle.files), ["rate-limiting/a.txt"]);
  });
});
