import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { validateManifest } from "../../src/domain/template-manifest.js";
import { emptyConfig } from "../../src/domain/template-config.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

/**
 * Collect the emitted project as a full path → content map, relative to the
 * project root. The assertion is over every emitted path and every byte of
 * its content — not a count.
 */
async function projectSnapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (e.isDirectory()) await walk(full);
      else out.set(rel, await fs.readFile(full, "utf-8"));
    }
  }
  await walk(root);
  return out;
}

describe("FileSystemFileEmitter — findings never reach a generated project (F-D3, lane G3)", () => {
  it("emits ci-github-actions with a findings/ dir byte-identically to emission without one", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "findings-emitter-"));
    try {
      // Ground truth for "before your change": a copy of the real templates
      // tree with the findings/ directories removed — exactly the state
      // lane G3 found, copied so the emitter reads two disjoint trees.
      const beforeTemplatesDir = path.join(tmp, "templates-before");
      await fs.cp(TEMPLATES_DIR, beforeTemplatesDir, {
        recursive: true,
        filter: (src) => {
          const rel = path.relative(TEMPLATES_DIR, src).split(path.sep);
          return !(rel.length >= 2 && rel[1] === "findings");
        },
      });
      const diff = await fs.readdir(
        path.join(beforeTemplatesDir, "ci-github-actions"),
      );
      assert.ok(
        !diff.includes("findings"),
        "fixture error: the before-tree still carries findings/ — the comparison would be tautological",
      );

      const manifest = validateManifest(
        JSON.parse(
          await fs.readFile(
            path.join(TEMPLATES_DIR, "ci-github-actions", "manifest.json"),
            "utf-8",
          ),
        ),
      );
      const answers = {
        ci_triggers: ["push-all-branches", "pull-request"],
        deploy_target: "vercel",
        preview_deploys: true,
        node_version: "22",
        docker_build: false,
        run_tests: true,
        cache_strategy: "turbo-cache",
      };

      const projectWith = path.join(tmp, "project-with-findings");
      const projectWithout = path.join(tmp, "project-without");
      await fs.mkdir(projectWith, { recursive: true });
      await fs.mkdir(projectWithout, { recursive: true });

      const withFindings = await new FileSystemFileEmitter(TEMPLATES_DIR).emit(
        manifest,
        answers,
        projectWith,
        emptyConfig(),
      );
      const withoutFindings = await new FileSystemFileEmitter(
        beforeTemplatesDir,
      ).emit(manifest, answers, projectWithout, emptyConfig());

      // The emitter only ever reads templates/<id>/files/**, so adding
      // findings/ must not change the emitted file set, the generated-file
      // records, or a single byte of content.
      assert.ok(
        !Array.from((await projectSnapshot(projectWith)).keys()).some((p) =>
          p.includes("findings"),
        ),
        "a findings/ path must never appear in an emitted project",
      );
      assert.deepEqual(withFindings, withoutFindings);
      assert.ok(
        withoutFindings.generatedFiles.length > 0,
        "fixture error: nothing was emitted — the comparison would be vacuous",
      );
      assert.deepStrictEqual(
        await projectSnapshot(projectWith),
        await projectSnapshot(projectWithout),
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
