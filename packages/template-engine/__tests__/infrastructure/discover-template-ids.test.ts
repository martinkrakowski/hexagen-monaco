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
      assert.match(err.message, /2 directories/);
      return true;
    });
  });

  it("excludes the reserved __ namespace without failing", async () => {
    await template("rate-limiting");
    await template("__example__", "__example__");

    assert.deepStrictEqual(await discoverTemplateIds(dir), ["rate-limiting"]);
  });

  it("ignores stray files, which cannot become a template id", async () => {
    await template("rate-limiting");
    await fs.writeFile(path.join(dir, "README.md"), "notes\n", "utf-8");
    await fs.writeFile(path.join(dir, ".DS_Store"), "\0", "utf-8");

    assert.deepStrictEqual(await discoverTemplateIds(dir), ["rate-limiting"]);
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
