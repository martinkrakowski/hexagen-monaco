import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest, outputPath } from "../../src/domain/index.js";
// Same enumeration the shipped bundle is built from — this guard used to walk
// templates/ under its own rules, and the two filters disagreeing is what let a
// stray directory reach the build.
import { discoverTemplateIds } from "../../src/infrastructure/build-template-bundle.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

/**
 * Phase 0 guard for the add-on-template → code-view materialization work
 * (docs/planning/hydrate-code-view-with-addon-templates.md).
 *
 * The web in-memory merge uses a "template overrides core" precedence for plain
 * files. That is only safe while NO template emits a structured/shared file
 * that must be *merged* rather than overwritten (a raw override of package.json
 * would destroy the core's dependencies; a shared root index.ts would drop
 * core wiring). An audit found zero such outputs across the current templates;
 * this guard fails CI the moment one is introduced, forcing an explicit merge
 * strategy to be registered before that template can ship.
 */
const COLLISION_PRONE: ReadonlyArray<{
  label: string;
  test: (p: string) => boolean;
}> = [
  { label: "package.json", test: (p) => /(^|\/)package\.json$/.test(p) },
  { label: "tsconfig", test: (p) => /(^|\/)tsconfig[^/]*\.json$/.test(p) },
  {
    label: "real .env (non-.example)",
    test: (p) => {
      const base = p.split("/").pop() ?? "";
      // Real .env / .env.local / .env.production — but not the namespaced
      // .env.*.example, nor unrelated dotfiles like .environment / .envrc.
      return /^\.env(\..+)?$/.test(base) && !base.endsWith(".example");
    },
  },
  { label: "shared root index", test: (p) => /^(src\/)?index\.ts$/.test(p) },
  {
    label: "Next root layout",
    test: (p) => /^(src\/)?app\/layout\.tsx?$/.test(p),
  },
  { label: "next.config", test: (p) => /^next\.config\.[mc]?[jt]s$/.test(p) },
];

// The files/** payload is inlined into the runtime (template-files.generated.ts)
// and held in web-process memory. The deploy target is a standalone Node server
// on a VPS (not a size-capped serverless function), so these limits are generous
// — they exist to notice runaway growth, not to micro-optimize.
const SOFT_LIMIT_BYTES = 5 * 1024 * 1024;
const HARD_LIMIT_BYTES = 15 * 1024 * 1024;

const listTemplateIds = (): Promise<string[]> =>
  discoverTemplateIds(TEMPLATES_DIR);

async function outputsFor(id: string): Promise<string[]> {
  const manifest = validateManifest(
    JSON.parse(
      await fs.readFile(path.join(TEMPLATES_DIR, id, "manifest.json"), "utf-8"),
    ),
  );
  return manifest.outputs.map(outputPath);
}

/**
 * Normalize a manifest output path before matching. Manifest paths are not
 * format-validated (the schema only requires a non-empty string), so collapse
 * backslashes to "/" and drop a leading "./" — otherwise a path variation like
 * "./package.json" would slip past the `^`-anchored matchers and later be
 * clobbered by the planned "template overrides core" precedence.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

async function dirSizeBytes(dir: string): Promise<number> {
  // A template legitimately may have no files/ dir → size 0. Any other IO error
  // (permissions, transient) must surface rather than be read as an empty payload
  // — otherwise the budget could pass without measuring the full content.
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return [];
      throw err;
    });
  let total = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // lstat, not stat: measure symlinks themselves rather than following them.
    total += e.isDirectory()
      ? await dirSizeBytes(full)
      : (await fs.lstat(full)).size;
  }
  return total;
}

describe("template guard — collision-prone outputs", () => {
  it("no template emits a structured/shared file that needs a merge strategy", async () => {
    const ids = await listTemplateIds();
    const offenders: string[] = [];
    for (const id of ids) {
      for (const raw of await outputsFor(id)) {
        const p = normalizePath(raw);
        const hit = COLLISION_PRONE.find((c) => c.test(p));
        if (hit) offenders.push(`${id} → ${raw} (${hit.label})`);
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `Template(s) emit collision-prone files that the "template overrides core" ` +
        `precedence would clobber. Register a merge strategy (deep-merge for JSON/.env, ` +
        `append/AST for shared singletons) before shipping:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("normalizes path variations so they cannot bypass the matchers", () => {
    for (const variant of [
      "./package.json",
      "src\\index.ts",
      "./app/layout.tsx",
    ]) {
      const p = normalizePath(variant);
      assert.ok(
        COLLISION_PRONE.some((c) => c.test(p)),
        `${variant} (→ ${p}) should be flagged collision-prone after normalization`,
      );
    }
  });
});

describe("template guard — payload size budget", () => {
  it(`files/** stays under the hard limit (${HARD_LIMIT_BYTES / 1048576} MB)`, async () => {
    const ids = await listTemplateIds();
    let total = 0;
    for (const id of ids) {
      total += await dirSizeBytes(path.join(TEMPLATES_DIR, id, "files"));
    }
    const mb = (total / 1048576).toFixed(2);

    if (total > SOFT_LIMIT_BYTES) {
      // eslint-disable-next-line no-console
      console.warn(
        `⚠️  template files/** payload is ${mb} MB (soft limit ` +
          `${SOFT_LIMIT_BYTES / 1048576} MB). It is inlined into the web runtime — ` +
          `consider trimming or lazy-loading before it grows further.`,
      );
    }

    assert.ok(
      total <= HARD_LIMIT_BYTES,
      `template files/** payload is ${mb} MB, over the hard limit of ` +
        `${HARD_LIMIT_BYTES / 1048576} MB.`,
    );
  });
});
