import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { validateManifest } from "../../src/domain/template-manifest.js";
import { emptyConfig } from "../../src/domain/template-config.js";
import type { AnswerMap } from "../../src/domain/question.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

/**
 * Collect the emitted project as a full path → content map, relative to the
 * project root. The assertion is over every emitted path and every byte of
 * its content — not a count. Directories are recorded too (as `dir/` → ""),
 * so an emitted *empty* directory named `findings` cannot escape the net by
 * holding no file: the path itself is evidence, and the snapshot equality
 * below compares the directory structure as well as the file bytes.
 */
async function projectSnapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (e.isDirectory()) {
        out.set(`${rel}/`, "");
        await walk(full);
      } else {
        out.set(rel, await fs.readFile(full, "utf-8"));
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * The premise check (F-D3): this suite proves "no generated project receives
 * a finding" by comparing emission against a findings-stripped copy of the
 * tree. That proof is only non-vacuous while the store is actually seeded —
 * if the findings/ directories were emptied or relocated, the comparison
 * would silently degenerate into two identical emissions. Every case therefore
 * asserts, up front, that the template it is about to emit carries at least
 * one file under `findings/` — and fails loudly when its own precondition is
 * gone, instead of reporting success.
 */
async function assertFindingsSeeded(templateId: string): Promise<void> {
  let files = 0;
  const findingsDir = path.join(TEMPLATES_DIR, templateId, "findings");
  async function walk(dir: string): Promise<void> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else files += 1;
    }
  }
  try {
    await walk(findingsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      assert.fail(
        `fixture error: templates/${templateId}/findings/ does not exist — ` +
          `this test's precondition (a seeded findings store) is gone; the ` +
          `comparison below would be vacuous, so it refuses to run`,
      );
    }
    throw err;
  }
  assert.ok(
    files > 0,
    `fixture error: templates/${templateId}/findings/ holds no file — ` +
      `the store this test guards has been emptied or relocated; restore the ` +
      `seed before trusting a green run`,
  );
}

/**
 * One case per seeded template: both templates carrying findings/ directories
 * are emitted, each through both `--with-tests` states, so the isolation
 * guarantee is not pinned to a single template, a single answer map, or the
 * default emit options.
 */
const CASES: ReadonlyArray<{ templateId: string; answers: AnswerMap }> = [
  {
    templateId: "ci-github-actions",
    answers: {
      ci_triggers: ["push-all-branches", "pull-request"],
      deploy_target: "vercel",
      preview_deploys: true,
      node_version: "22",
      docker_build: false,
      run_tests: true,
      cache_strategy: "turbo-cache",
    },
  },
  {
    templateId: "agents-md",
    answers: {
      project_description: "A generated HexaGen monorepo",
      architecture_style: "hexagonal",
      session_logging: false,
    },
  },
];

describe("FileSystemFileEmitter — findings never reach a generated project (F-D3, lane G3)", () => {
  for (const { templateId, answers } of CASES) {
    for (const withTests of [false, true] as const) {
      it(`emits ${templateId} (withTests: ${withTests}) with a findings/ dir byte-identically to emission without one, and findings/ never appears in the project`, async () => {
        // Premise first: the store must be seeded, or the comparison is
        // vacuous and must fail before it can pass.
        await assertFindingsSeeded(templateId);

        const tmp = await fs.mkdtemp(
          path.join(os.tmpdir(), "findings-emitter-"),
        );
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
            path.join(beforeTemplatesDir, templateId),
          );
          assert.ok(
            !diff.includes("findings"),
            "fixture error: the before-tree still carries findings/ — the comparison would be tautological",
          );

          const manifest = validateManifest(
            JSON.parse(
              await fs.readFile(
                path.join(TEMPLATES_DIR, templateId, "manifest.json"),
                "utf-8",
              ),
            ),
          );

          const projectWith = path.join(tmp, "project-with-findings");
          const projectWithout = path.join(tmp, "project-without");
          await fs.mkdir(projectWith, { recursive: true });
          await fs.mkdir(projectWithout, { recursive: true });

          const withFindings = await new FileSystemFileEmitter(TEMPLATES_DIR, {
            withTests,
          }).emit(manifest, answers, projectWith, emptyConfig());
          const withoutFindings = await new FileSystemFileEmitter(
            beforeTemplatesDir,
            { withTests },
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
    }
  }
});
