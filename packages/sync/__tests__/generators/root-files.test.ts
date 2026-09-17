import { describe, it } from "vitest";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRootFiles } from "../../src/generators/root-files.js";
import { generateApps } from "../../src/generators/apps.js";
import type { Manifest, AppFramework } from "../../src/types/manifest.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";

const execFileAsync = promisify(execFile);

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// Deliberately NOT `import prettier from "prettier"`: this package does not
// (and must not) declare a `prettier` dependency — `yarn install --immutable`
// rejects an undeclared workspace dependency regardless of whether the exact
// range is already declared elsewhere (Yarn Berry records dependencies per
// workspace, not repo-wide), and `yarn.lock` is a never-edit file (AGENTS.md).
// `prettier` IS a root devDependency, so its binary is on disk in the
// repo-root `node_modules/` regardless — invoked here as a subprocess (no
// module resolution, no package.json footprint), anchored to a filesystem
// path derived from this test file's own location rather than PATH/hoisting,
// which is exactly the ambient-resolution failure mode
// `workspace-tool-declaration.guard.test.ts` (in this same directory's
// parent) exists to catch for `scripts`, applied here to a source import.
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const PRETTIER_BIN = path.join(
  REPO_ROOT,
  "node_modules",
  "prettier",
  "bin",
  "prettier.cjs",
);

/**
 * Asserts `filePath` needs no reformatting under `prettierrcPath` — i.e.
 * `prettier --check` exits 0. `--no-editorconfig` keeps the check hermetic:
 * an `.editorconfig` found by walking up from a `mkdtemp` path (however
 * unlikely) must never change the result. Exit code 1 means "would
 * reformat"; anything else (parse error, missing binary, …) is a hard
 * failure, not a silent pass.
 */
async function assertPrettierClean(
  filePath: string,
  prettierrcPath: string,
): Promise<void> {
  try {
    await execFileAsync(process.execPath, [
      PRETTIER_BIN,
      "--check",
      "--config",
      prettierrcPath,
      "--no-editorconfig",
      filePath,
    ]);
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    assert.fail(
      `${filePath} is not Prettier-clean under ${prettierrcPath} ` +
        `(a freshly generated project's first \`yarn format\` must produce ` +
        `no diff) — prettier --check exited ${e.code}:\n${e.stdout ?? ""}${e.stderr ?? ""}`,
    );
  }
}

/**
 * Asserts that NOTHING matching `glob` under `cwd` needs reformatting —
 * i.e. runs the emitted `format` script's own check
 * (`prettier --check "**\/*.{ts,tsx}"`) for real, from `cwd`, exactly as
 * `yarn format` would invoke it (the glob is passed as a single argv
 * element, unexpanded by a shell, matching how the package.json script
 * quotes it — `execFile` never invokes a shell either, so this is the same
 * invocation shape, not an approximation of it).
 */
async function assertPrettierCleanGlob(
  cwd: string,
  glob: string,
  prettierrcPath: string,
): Promise<void> {
  try {
    await execFileAsync(
      process.execPath,
      [
        PRETTIER_BIN,
        "--check",
        "--config",
        prettierrcPath,
        "--no-editorconfig",
        glob,
      ],
      { cwd },
    );
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    assert.fail(
      `\`prettier --check "${glob}"\` (from ${cwd}) is not clean under ` +
        `${prettierrcPath} — a freshly generated project's first \`yarn format\` ` +
        `must produce no diff — exited ${e.code}:\n${e.stdout ?? ""}${e.stderr ?? ""}`,
    );
  }
}

const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

function makeSpyLogger(): {
  logger: LoggerPort;
  warnCalls: Array<{ msg: string; ctx?: unknown }>;
} {
  const warnCalls: Array<{ msg: string; ctx?: unknown }> = [];
  const logger: LoggerPort = {
    error: () => {},
    warn: (msg, ctx) => {
      warnCalls.push({ msg, ctx });
    },
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
  return { logger, warnCalls };
}

function makeConfig(
  workspaceRoot: string,
  manifest: Manifest,
  overrides: Partial<SyncConfig> = {},
): SyncConfig {
  return {
    dryRun: false,
    force: false,
    forceRoot: false,
    allowDirty: false,
    strict: false,
    mode: "external",
    logger: silentLogger,
    manifest,
    workspaceRoot,
    ...overrides,
  };
}

async function withTempWorkspace(
  fn: (ctx: { workspaceRoot: string }) => Promise<void>,
) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-rootfiles-test-"),
  );
  try {
    await fn({ workspaceRoot });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("root files", () => {
  it("should create all three root files on clean temp dir", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const manifest: Manifest = { system: "test-project" };
      const config = makeConfig(workspaceRoot, manifest, { forceRoot: true });

      const result = await generateRootFiles(config);

      assert.strictEqual(
        result.error,
        undefined,
        "generator must not report an error on a clean temp dir",
      );
      assert.strictEqual(
        result.created.length,
        7,
        "should report seven created files (package.json, tsconfig.base.json, turbo.json, .gitignore, .yarnrc.yml, SETUP.md, .prettierrc.json)",
      );
      assert.strictEqual(result.updated.length, 0);
      assert.strictEqual(result.skipped.length, 0);
      assert.strictEqual(result.totalOps, 7);

      for (const name of [
        "package.json",
        "tsconfig.base.json",
        "turbo.json",
        ".prettierrc.json",
      ]) {
        const p = path.join(workspaceRoot, name);
        assert.strictEqual(
          await fileExists(p),
          true,
          `${name} must exist after generation`,
        );
        const content = await readFile(p);
        assert.doesNotThrow(
          () => JSON.parse(content),
          `${name} must be valid JSON after interpolation`,
        );
      }

      for (const name of [".gitignore", ".yarnrc.yml", "SETUP.md"]) {
        assert.strictEqual(
          await fileExists(path.join(workspaceRoot, name)),
          true,
          `${name} must exist after generation`,
        );
      }

      const pkg = JSON.parse(
        await readFile(path.join(workspaceRoot, "package.json")),
      ) as Record<string, unknown>;
      assert.strictEqual(
        pkg.name,
        "test-project",
        "built-in package.json must interpolate {system} into `name`",
      );
    });
  });

  it("should use manifest rootFiles packageJson template when present", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const customTemplate = `{"name":"{system}","custom":true}`;
      const manifest: Manifest = {
        system: "custom-system",
        monorepo: {
          rootFiles: {
            packageJson: { template: customTemplate },
          },
        },
      };
      const config = makeConfig(workspaceRoot, manifest, { forceRoot: true });

      await generateRootFiles(config);

      const content = await readFile(path.join(workspaceRoot, "package.json"));
      assert.strictEqual(
        content,
        `{"name":"custom-system","custom":true}`,
        "manifest-supplied template must be used verbatim (with interpolation)",
      );
      assert.strictEqual(
        content.includes("workspaces"),
        false,
        "built-in must NOT have leaked through when manifest provides a template",
      );
    });
  });

  it("should fall back to built-in templates when manifest has no rootFiles section", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const manifest: Manifest = {
        system: "fallback-project",
      };
      const config = makeConfig(workspaceRoot, manifest, { forceRoot: true });

      await generateRootFiles(config);

      const pkg = await readFile(path.join(workspaceRoot, "package.json"));
      assert.ok(
        pkg.includes(`"build": "turbo build"`),
        "built-in package.json must include the turbo build script",
      );
      assert.ok(
        pkg.includes(`"@hexagen-monaco/sync"`),
        "built-in package.json must include @hexagen-monaco/sync (the published tooling scope) in devDependencies",
      );

      const tsconfig = await readFile(
        path.join(workspaceRoot, "tsconfig.base.json"),
      );
      assert.ok(
        tsconfig.includes(`"moduleResolution": "bundler"`),
        "built-in tsconfig.base.json must declare moduleResolution=bundler",
      );
      // #2: forward-looking dependency `.d.ts` (e.g. a lib type newer than the
      // configured `lib`) must not fail the consumer's typecheck. Matches the
      // skipLibCheck the hexagen-monaco repo itself sets in its base config.
      assert.ok(
        JSON.parse(tsconfig).compilerOptions?.skipLibCheck === true,
        "built-in tsconfig.base.json must set skipLibCheck:true (#2 — forward-looking dependency .d.ts)",
      );

      const turbo = await readFile(path.join(workspaceRoot, "turbo.json"));
      assert.ok(
        turbo.includes(`"$schema": "https://turbo.build/schema.json"`),
        "built-in turbo.json must include the turbo schema pointer",
      );
      // #2 (the TS6305 fix): packages resolve each other via project references
      // to built `dist/*.d.ts` (paths:{} per ADR-0004), so `typecheck`
      // (`tsc --noEmit`) must build referenced composite outputs first — exactly
      // as the hexagen-monaco repo's own turbo.json does. Without `^build` a
      // fresh clone's `yarn typecheck` raises TS6305 ("output file has not been
      // built from source file").
      assert.deepStrictEqual(
        JSON.parse(turbo).tasks?.typecheck?.dependsOn,
        ["^build"],
        "built-in turbo.json `typecheck` task must dependOn ^build (#2 — TS6305 on fresh clone)",
      );
    });
  });

  it("should interpolate {system}, {scope}, {packageManager}, and {workspaces}", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const template = `{
  "system": "{system}",
  "scope": "{scope}",
  "packageManager": "{packageManager}",
  "workspaces": {workspaces}
}`;
      const manifest: Manifest = {
        system: "my-app",
        // Deliberately includes a leading "@" to exercise scope sanitization
        // (npm scopes are stored bare; the leading @ is stripped).
        scope: "@my-scope",
        monorepo: {
          packageManager: "pnpm@9.0.0",
          workspaces: ["apps/*", "packages/*", "libs/*"],
          rootFiles: {
            packageJson: { template },
          },
        },
      };
      const config = makeConfig(workspaceRoot, manifest, { forceRoot: true });

      await generateRootFiles(config);

      const content = await readFile(path.join(workspaceRoot, "package.json"));
      assert.ok(
        content.includes(`"system": "my-app"`),
        "{system} must be interpolated into the template",
      );
      assert.ok(
        content.includes(`"scope": "my-scope"`),
        "{scope} must be interpolated (sanitized — leading @ stripped)",
      );
      assert.ok(
        content.includes(`"packageManager": "pnpm@9.0.0"`),
        "{packageManager} must be interpolated into the template",
      );
      const parsed = JSON.parse(content) as {
        workspaces: string[];
        system: string;
        scope: string;
      };
      assert.deepStrictEqual(
        parsed.workspaces,
        ["apps/*", "packages/*", "libs/*"],
        "{workspaces} must be interpolated as a JSON array fragment",
      );
    });
  });

  it("should not overwrite protected turbo.json without forceRoot", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const preExistingTurbo = `{"preExisting": true}`;
      const turboPath = path.join(workspaceRoot, "turbo.json");
      await fs.writeFile(turboPath, preExistingTurbo, "utf8");

      const manifest: Manifest = { system: "x" };
      const config = makeConfig(workspaceRoot, manifest, { forceRoot: false });

      const result = await generateRootFiles(config);

      const contentAfter = await readFile(turboPath);
      assert.strictEqual(
        contentAfter,
        preExistingTurbo,
        "existing turbo.json must NOT be overwritten without --force-root",
      );
      assert.ok(
        result.skipped.includes(turboPath),
        "protected turbo.json must be reported in result.skipped",
      );
    });
  });

  it("should overwrite protected turbo.json with forceRoot", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const preExistingTurbo = `{"preExisting": true}`;
      const turboPath = path.join(workspaceRoot, "turbo.json");
      await fs.writeFile(turboPath, preExistingTurbo, "utf8");

      const manifest: Manifest = { system: "x" };
      const config = makeConfig(workspaceRoot, manifest, { forceRoot: true });

      const result = await generateRootFiles(config);

      const contentAfter = await readFile(turboPath);
      assert.notStrictEqual(
        contentAfter,
        preExistingTurbo,
        "existing turbo.json MUST be overwritten with --force-root",
      );
      assert.ok(
        contentAfter.includes(`"$schema": "https://turbo.build/schema.json"`),
        "overwritten turbo.json must contain the built-in template content",
      );
      assert.ok(
        result.updated.includes(turboPath),
        "overwritten turbo.json must be reported in result.updated",
      );
    });
  });

  it("should perform no write when content hash matches", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const manifest: Manifest = { system: "idem-project" };
      const firstPassConfig = makeConfig(workspaceRoot, manifest, {
        forceRoot: true,
      });
      await generateRootFiles(firstPassConfig);

      const pkgPath = path.join(workspaceRoot, "package.json");
      const firstMtime = (await fs.stat(pkgPath)).mtimeMs;

      const firstContent = await readFile(pkgPath);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const secondPassConfig = makeConfig(workspaceRoot, manifest, {
        forceRoot: false,
      });
      const result = await generateRootFiles(secondPassConfig);

      const secondContent = await readFile(pkgPath);
      const secondMtime = (await fs.stat(pkgPath)).mtimeMs;

      assert.strictEqual(
        secondContent,
        firstContent,
        "package.json content must be byte-identical after an idempotent re-run",
      );
      assert.strictEqual(
        secondMtime,
        firstMtime,
        "package.json mtime must be unchanged — no write should have occurred",
      );
      assert.strictEqual(
        result.created.includes(pkgPath),
        false,
        "unchanged package.json must NOT be reported as created",
      );
      assert.strictEqual(
        result.updated.includes(pkgPath),
        false,
        "unchanged package.json must NOT be reported as updated",
      );
      assert.strictEqual(
        result.skipped.includes(pkgPath),
        false,
        "unchanged package.json must NOT be reported as skipped",
      );
    });
  });

  it("should emit logger.warn for unresolved template variables", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const { logger, warnCalls } = makeSpyLogger();
      const manifest: Manifest = {
        system: "has-a-system",
        monorepo: {
          rootFiles: {
            packageJson: {
              template: `{"name":"{system}","missing":"{missingVar}"}`,
            },
          },
        },
      };
      const config = makeConfig(workspaceRoot, manifest, {
        forceRoot: true,
        logger,
      });

      await generateRootFiles(config);

      const matching = warnCalls.filter(
        (c) =>
          c.msg.includes("package.json") &&
          c.msg.includes("{missingVar}") &&
          c.msg.includes("unresolved template variables"),
      );
      assert.strictEqual(
        matching.length,
        1,
        `expected exactly one logger.warn call naming {missingVar} for package.json — received ${warnCalls.length} warn calls total`,
      );

      const content = await readFile(path.join(workspaceRoot, "package.json"));
      assert.ok(
        content.includes("{missingVar}"),
        "unresolved placeholder must remain in the output verbatim",
      );
      assert.ok(
        content.includes(`"name":"has-a-system"`),
        "resolved placeholders must still be interpolated alongside unresolved ones",
      );
    });
  });

  // Item 2 — CI hardening: the scaffold must carry the first-run install files.
  describe("first-run install scaffolding", () => {
    it("emits .gitignore, .yarnrc.yml, and SETUP.md for a bare (zero-context) project", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = { system: "bare-app", scope: "bare" };
        const config = makeConfig(workspaceRoot, manifest, {
          forceRoot: true,
        });

        await generateRootFiles(config);

        const gitignore = await readFile(
          path.join(workspaceRoot, ".gitignore"),
        );
        assert.ok(
          gitignore.includes("node_modules/") &&
            gitignore.includes(".turbo/") &&
            gitignore.includes(".env"),
          ".gitignore must cover node_modules/.turbo/.env",
        );
        // F20: failed/partial tsc runs leave vitest.config declaration
        // artifacts at package roots — cover them so a fresh repo's
        // `git status` stays clean.
        assert.ok(
          gitignore.includes("packages/*/vitest.config.d.ts") &&
            gitignore.includes("packages/*/vitest.config.d.ts.map"),
          ".gitignore must cover packages/*/vitest.config.d.ts(.map) tsc artifacts",
        );

        const yarnrc = await readFile(path.join(workspaceRoot, ".yarnrc.yml"));
        assert.ok(
          yarnrc.includes("nodeLinker: node-modules"),
          ".yarnrc.yml must set nodeLinker: node-modules",
        );

        const setup = await readFile(path.join(workspaceRoot, "SETUP.md"));
        assert.ok(
          setup.includes("git add yarn.lock"),
          "SETUP.md must name the lockfile-commit step",
        );
        assert.ok(
          setup.includes("corepack enable") && setup.includes("yarn install"),
          "SETUP.md must list the first-push bootstrap steps",
        );
        assert.ok(
          !setup.includes("{packageManager}") && !setup.includes("{system}"),
          "SETUP.md must not leak uninterpolated tokens",
        );

        // The bare scaffold's root package.json is still valid and runnable.
        const pkg = JSON.parse(
          await readFile(path.join(workspaceRoot, "package.json")),
        ) as { scripts?: Record<string, string> };
        for (const s of ["build", "lint", "typecheck", "test"]) {
          assert.ok(
            pkg.scripts?.[s],
            `root package.json must have a ${s} script`,
          );
        }
      });
    });

    it("anchors the Next.js export dir so a bare out/ can't shadow ports/out/ source (#1)", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = { system: "ports-app", scope: "ports" };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const gitignore = await readFile(
          path.join(workspaceRoot, ".gitignore"),
        );
        const lines = gitignore.split("\n").map((l) => l.trim());

        // A bare `out/` matches a dir named `out` at ANY depth, silently ignoring
        // every bounded context's src/application/ports/out/ outbound-port source.
        assert.ok(
          !lines.includes("out/"),
          ".gitignore must not contain a bare `out/` pattern (it shadows hexagonal ports/out/ source)",
        );
        assert.ok(
          lines.includes("apps/*/out/"),
          ".gitignore must anchor the Next.js static export to apps/*/out/",
        );
      });
    });

    it("honors a manifest rootFiles override for the new files", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = {
          system: "ovr",
          monorepo: {
            rootFiles: {
              gitignore: { template: "custom-ignore\n" },
              yarnrc: { template: "nodeLinker: pnp\n" },
              setup: { template: "Custom setup for {system}\n" },
            },
          },
        };
        const config = makeConfig(workspaceRoot, manifest, {
          forceRoot: true,
        });

        await generateRootFiles(config);

        assert.strictEqual(
          await readFile(path.join(workspaceRoot, ".gitignore")),
          "custom-ignore\n",
        );
        assert.strictEqual(
          await readFile(path.join(workspaceRoot, ".yarnrc.yml")),
          "nodeLinker: pnp\n",
        );
        assert.strictEqual(
          await readFile(path.join(workspaceRoot, "SETUP.md")),
          "Custom setup for ovr\n",
          "manifest override is used and still interpolated",
        );
      });
    });

    it("does NOT clobber a user-edited .yarnrc.yml / SETUP.md on re-sync (protected)", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = { system: "prot" };
        // First pass creates the files.
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        // User customizes them.
        const edited = "nodeLinker: node-modules\nnpmScopes:\n  acme: {}\n";
        await fs.writeFile(
          path.join(workspaceRoot, ".yarnrc.yml"),
          edited,
          "utf8",
        );
        await fs.writeFile(
          path.join(workspaceRoot, "SETUP.md"),
          "my notes\n",
          "utf8",
        );

        // Re-sync WITHOUT forceRoot must not overwrite protected root files.
        await generateRootFiles(makeConfig(workspaceRoot, manifest));

        assert.strictEqual(
          await readFile(path.join(workspaceRoot, ".yarnrc.yml")),
          edited,
          ".yarnrc.yml edits must survive a re-sync",
        );
        assert.strictEqual(
          await readFile(path.join(workspaceRoot, "SETUP.md")),
          "my notes\n",
          "SETUP.md edits must survive a re-sync",
        );
      });
    });

    it("self-regen guard (PR-A3): an existing root package.json is never rewritten with template pins", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        // The hexagen-monaco shape: a hand-maintained root package.json that a
        // self-regen sync must leave alone. The guard is root-file PROTECTION
        // (mode-agnostic, blocks create AND update without --force-root) — not
        // a mode check; this pins it for package.json specifically, since A3
        // makes the template emit version-derived pins that must never land in
        // the repo's own root.
        const handWritten = `{"name":"hexagen-monaco","devDependencies":{"turbo":"^2.0.0"}}`;
        const pkgPath = path.join(workspaceRoot, "package.json");
        await fs.writeFile(pkgPath, handWritten, "utf8");

        const manifest: Manifest = { system: "hexagen-monaco" };
        const result = await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { mode: "self-regen" }),
        );

        assert.strictEqual(
          await readFile(pkgPath),
          handWritten,
          "self-regen must leave an existing root package.json byte-identical",
        );
        assert.ok(
          result.skipped.includes(pkgPath),
          "the protected root package.json must be reported as skipped",
        );
        assert.strictEqual(
          result.created.length,
          0,
          "a self-regen run without --force-root must create no root files",
        );
      });
    });

    it("pins both @hexagen-monaco/* devDependencies at the engine's own version (PR-A3, RCA #1)", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const engineVersion = (
          JSON.parse(
            await readFile(path.join(PACKAGE_ROOT, "package.json")),
          ) as { version: string }
        ).version;
        assert.notStrictEqual(
          engineVersion,
          "0.0.0",
          "sanity: the workspace version must not itself be degenerate",
        );

        const manifest: Manifest = { system: "pinned-app", scope: "pinned" };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const pkg = JSON.parse(
          await readFile(path.join(workspaceRoot, "package.json")),
        ) as { devDependencies?: Record<string, string> };
        // Workspace name is @hexagen/sync, pins are the public scope — same
        // version number by the co-release invariant (publish.yml).
        assert.strictEqual(
          pkg.devDependencies?.["@hexagen-monaco/sync"],
          `^${engineVersion}`,
          "scaffold must pin @hexagen-monaco/sync at the engine's own version",
        );
        assert.strictEqual(
          pkg.devDependencies?.["@hexagen-monaco/arch-linter"],
          `^${engineVersion}`,
          "scaffold must pin @hexagen-monaco/arch-linter at the engine's own version",
        );
      });
    });

    it("no hardcoded 0.4.0 pin survives anywhere in src/generators/ (PR-A3 regression sweep)", async () => {
      // The RCA #1 bug class: a literal version in a template silently going
      // stale across releases. Sweep the whole generators tree so a hardcode
      // can't come back in ANY emitter, not just root-file-templates.ts.
      const generatorsDir = path.join(PACKAGE_ROOT, "src", "generators");
      const offenders: string[] = [];
      async function walk(dir: string): Promise<void> {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(abs);
          } else if (entry.isFile() && entry.name.endsWith(".ts")) {
            if ((await readFile(abs)).includes("0.4.0")) {
              offenders.push(path.relative(generatorsDir, abs));
            }
          }
        }
      }
      await walk(generatorsDir);
      assert.deepStrictEqual(
        offenders,
        [],
        "literal 0.4.0 found in generators — toolchain pins must derive from resolveToolchainVersion()",
      );

      // And the template must carry the placeholder on both tooling pins.
      const template = await readFile(
        path.join(generatorsDir, "root-file-templates.ts"),
      );
      assert.ok(
        template.includes(`"@hexagen-monaco/sync": "^{toolchainVersion}"`) &&
          template.includes(
            `"@hexagen-monaco/arch-linter": "^{toolchainVersion}"`,
          ),
        "built-in package.json template must pin both tooling packages via {toolchainVersion}",
      );
    });

    it("does NOT recreate a deleted SETUP.md on a normal re-sync", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = { system: "del" };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        // User follows the "delete after first push" guidance.
        await fs.rm(path.join(workspaceRoot, "SETUP.md"));

        // A normal sync (no forceRoot) must leave it deleted — protected root
        // files are only (re)written under --force-root.
        const result = await generateRootFiles(
          makeConfig(workspaceRoot, manifest),
        );

        assert.strictEqual(
          await fileExists(path.join(workspaceRoot, "SETUP.md")),
          false,
          "deleted SETUP.md must stay gone after a normal sync",
        );
        assert.strictEqual(
          result.created.length,
          0,
          "a normal re-sync must create nothing (all root files protected)",
        );
      });
    });
  });

  describe("gitignore env examples (F3)", () => {
    it("re-includes .env.*.example files after the .env.* ignore", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = { system: "envtest" };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const gitignore = await readFile(
          path.join(workspaceRoot, ".gitignore"),
        );
        const lines = gitignore.split("\n").map((l) => l.trim());
        const ignoreAt = lines.indexOf(".env.*");
        const reincludeAt = lines.indexOf("!.env.*.example");
        assert.ok(ignoreAt >= 0, ".gitignore must ignore .env.*");
        assert.ok(
          reincludeAt >= 0,
          ".gitignore must re-include .env.*.example (F3 — add-on templates ship .env.bullmq.example etc.)",
        );
        assert.ok(
          reincludeAt > ignoreAt,
          "the !.env.*.example re-include must come AFTER the .env.* ignore (gitignore last-match-wins)",
        );
      });
    });
  });

  describe("turboConfig consumption (F15)", () => {
    it("emits manifest turboConfig (globalDependencies + pipeline→tasks) instead of dropping it", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = {
          system: "turbotest",
          monorepo: {
            turboConfig: {
              globalDependencies: ["**/.env.*"],
              pipeline: {
                build: { dependsOn: ["^build"], outputs: ["dist/**"] },
                lint: { dependsOn: ["^build"] },
                test: { dependsOn: ["^build"] },
                typecheck: { dependsOn: ["^build"], outputs: [], cache: true },
              },
            },
          },
        };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const turbo = JSON.parse(
          await readFile(path.join(workspaceRoot, "turbo.json")),
        ) as Record<string, unknown>;
        assert.deepStrictEqual(
          turbo.globalDependencies,
          ["**/.env.*"],
          "manifest globalDependencies must be emitted verbatim (F15 — env changes must invalidate the cache)",
        );
        const tasks = turbo.tasks as Record<
          string,
          { dependsOn?: string[]; outputs?: string[] }
        >;
        assert.deepStrictEqual(
          tasks.build,
          { dependsOn: ["^build"], outputs: ["dist/**"] },
          "manifest pipeline tasks must be emitted under Turbo 2's `tasks` key",
        );
        assert.strictEqual(
          turbo.pipeline,
          undefined,
          "the legacy `pipeline` key must NOT be emitted (Turbo 2 rejects it)",
        );
        assert.ok(
          tasks.dev,
          "built-in tasks the manifest does not mention (dev) must be preserved so `turbo dev` still resolves",
        );
        assert.deepStrictEqual(
          tasks.typecheck?.dependsOn,
          ["^build"],
          "typecheck must keep ^build (#2 — TS6305 on fresh clone)",
        );
      });
    });

    it("appends Next/Nitro build outputs when the manifest declares such apps", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = {
          system: "fw-outputs",
          apps: [
            { name: "web", framework: "next.js" },
            { name: "api", framework: "nitro" },
          ],
          monorepo: {
            turboConfig: {
              pipeline: {
                build: { dependsOn: ["^build"], outputs: ["dist/**"] },
              },
            },
          },
        };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const turbo = JSON.parse(
          await readFile(path.join(workspaceRoot, "turbo.json")),
        ) as { tasks?: { build?: { outputs?: string[] } } };
        assert.deepStrictEqual(
          turbo.tasks?.build?.outputs,
          ["dist/**", ".next/**", "!.next/cache/**", ".output/**", ".nitro/**"],
          "build outputs must include the Next/Nitro output dirs (F15 — else app builds are uncacheable)",
        );
      });
    });

    it("does NOT append framework outputs when no Next/Nitro app exists", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = {
          system: "no-fw",
          apps: [{ name: "cli", framework: "plain-ts" }],
          monorepo: {
            turboConfig: {
              pipeline: {
                build: { dependsOn: ["^build"], outputs: ["dist/**"] },
              },
            },
          },
        };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const turbo = JSON.parse(
          await readFile(path.join(workspaceRoot, "turbo.json")),
        ) as { tasks?: { build?: { outputs?: string[] } } };
        assert.deepStrictEqual(turbo.tasks?.build?.outputs, ["dist/**"]);
      });
    });

    it("an explicit rootFiles.turbo.template still wins over turboConfig", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        // Pretty-printed on purpose: manifest-supplied templates pass through
        // interpolate(), whose escape rule collapses adjacent `}}` into `}` —
        // compact JSON would be mangled (the builtin templates are
        // pretty-printed for the same reason).
        const customTemplate = `{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "outputs": ["custom/**"] }
  }
}`;
        const manifest: Manifest = {
          system: "override",
          monorepo: {
            turboConfig: {
              globalDependencies: ["**/.env.*"],
              pipeline: { build: { outputs: ["out/**"] } },
            },
            rootFiles: { turbo: { template: customTemplate } },
          },
        };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const content = await readFile(path.join(workspaceRoot, "turbo.json"));
        assert.strictEqual(
          content,
          customTemplate,
          "author-supplied full template is the most specific override and must be used verbatim",
        );
      });
    });
  });

  // L3 (gates-for-generated-projects): root-file-templates.ts emitted a
  // `format` script with no config — a script without a config reformats to
  // Prettier's own defaults on first run, burying real diffs under whole-file
  // churn. See docs/planning/implementation/2026-09-17-gates-for-generated-projects-impl.md §3 L3.
  describe("prettier config (L3)", () => {
    it("emits .prettierrc.json with the chosen built-in content", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = { system: "prettier-test" };
        const result = await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const prettierrcPath = path.join(workspaceRoot, ".prettierrc.json");
        assert.strictEqual(
          await fileExists(prettierrcPath),
          true,
          ".prettierrc.json must exist after generation",
        );
        const parsed = JSON.parse(await readFile(prettierrcPath)) as Record<
          string,
          unknown
        >;
        assert.deepStrictEqual(
          parsed,
          {
            semi: true,
            singleQuote: false,
            trailingComma: "all",
            printWidth: 80,
            tabWidth: 2,
            arrowParens: "always",
            endOfLine: "lf",
            objectWrap: "preserve",
          },
          "built-in .prettierrc.json must pin Prettier 3's own defaults explicitly",
        );
        assert.ok(
          result.created.includes(prettierrcPath),
          ".prettierrc.json must be reported as created",
        );
      });
    });

    it("honors a manifest rootFiles.prettierrc override, like every other root file", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const customTemplate = `{"printWidth":100}\n`;
        const manifest: Manifest = {
          system: "prettier-ovr",
          monorepo: {
            rootFiles: {
              prettierrc: { template: customTemplate },
            },
          },
        };
        const config = makeConfig(workspaceRoot, manifest, {
          forceRoot: true,
        });

        await generateRootFiles(config);

        assert.strictEqual(
          await readFile(path.join(workspaceRoot, ".prettierrc.json")),
          customTemplate,
          "manifest-supplied .prettierrc.json template must be used verbatim",
        );
      });
    });

    it("does NOT clobber a user-edited .prettierrc.json on re-sync (protected)", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = { system: "prettier-protected" };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const edited = `{"semi":false}\n`;
        await fs.writeFile(
          path.join(workspaceRoot, ".prettierrc.json"),
          edited,
          "utf8",
        );

        // Re-sync WITHOUT forceRoot must not overwrite protected root files.
        await generateRootFiles(makeConfig(workspaceRoot, manifest));

        assert.strictEqual(
          await readFile(path.join(workspaceRoot, ".prettierrc.json")),
          edited,
          ".prettierrc.json edits must survive a re-sync without --force-root",
        );
      });
    });

    it("drops `md` from the emitted format script's glob", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = { system: "glob-test" };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const pkg = JSON.parse(
          await readFile(path.join(workspaceRoot, "package.json")),
        ) as { scripts?: Record<string, string> };
        assert.strictEqual(
          pkg.scripts?.format,
          'prettier --write "**/*.{ts,tsx}"',
          "the format script must target only ts/tsx — a wider md glob rewraps hand-wrapped prose (planning docs, AGENTS.md) into an unreviewable diff",
        );
        assert.ok(
          !pkg.scripts?.format?.includes("md"),
          "the format script glob must not include md",
        );
      });
    });

    // Root-file coverage: it is not enough that a config exists — the DoD is
    // that `yarn format` on a freshly generated project produces NO diff.
    // This runs the real `prettier` binary (the root workspace's own
    // devDependency, invoked as a subprocess — see assertPrettierClean above
    // for why not an `import`) against every JSON/YAML/Markdown root file the
    // generator emits, using the exact config content the generator itself
    // just wrote, on a manifest that exercises every dynamic array path
    // (custom workspaces, turboConfig pipeline + globalDependencies, and
    // Next.js/Nitro framework build outputs) — not just the static built-in
    // defaults.
    //
    // NOTE — this alone does NOT establish the DoD: the emitted `format`
    // script is `prettier --write "**/*.{ts,tsx}"`, and every file checked
    // here is JSON/YAML/Markdown — disjoint from what that glob will ever
    // touch. Proving those five files are clean says nothing about whether
    // `yarn format` itself is a no-op. See the next test for the glob the
    // script actually targets.
    it("root files (package.json, tsconfig.base.json, turbo.json, .yarnrc.yml, SETUP.md) are Prettier-clean", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const manifest: Manifest = {
          system: "no-diff-project",
          apps: [
            { name: "web", framework: "next.js" },
            { name: "api", framework: "nitro" },
          ],
          monorepo: {
            workspaces: ["apps/*", "packages/*", "libs/*"],
            turboConfig: {
              globalDependencies: ["**/.env.*"],
              pipeline: {
                build: { dependsOn: ["^build"], outputs: ["dist/**"] },
                lint: { dependsOn: ["^build"] },
                test: { dependsOn: ["^build"] },
                typecheck: {
                  dependsOn: ["^build"],
                  outputs: [],
                  cache: true,
                },
              },
            },
          },
        };
        await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );

        const prettierrcPath = path.join(workspaceRoot, ".prettierrc.json");

        // .gitignore is deliberately excluded: Prettier has no parser for
        // gitignore syntax (`getFileInfo(".gitignore")` reports
        // `inferredParser: null`), so it is out of scope for a Prettier
        // config in exactly the same way it is out of the emitted `format`
        // script's ts/tsx glob — there is nothing for either to reformat.
        for (const name of [
          "package.json",
          "tsconfig.base.json",
          "turbo.json",
          ".yarnrc.yml",
          "SETUP.md",
        ]) {
          await assertPrettierClean(
            path.join(workspaceRoot, name),
            prettierrcPath,
          );
        }
      });
    });

    // THE DoD, proven against what the format script actually targets.
    //
    // Two independent reviewers found the same structural gap: the test
    // above checks root files, but `format` is
    // `prettier --write "**/*.{ts,tsx}"` — zero overlap with what it proved.
    // This generates the emitted .ts/.tsx CONTENT through the real engine
    // (`generateApps`, not by listing BUILTIN_FRAMEWORK_TEMPLATES constants
    // by hand — a hand-copied list would silently stop covering a template
    // the moment someone added a new framework or edited an existing one),
    // for every built-in app framework, then runs the real
    // `prettier --check "**/*.{ts,tsx}"` from the workspace root — the exact
    // command the generated `format` script's glob resolves, not an
    // approximation of it.
    //
    // Scope: this covers root files + every built-in app-framework template
    // (apps-framework-templates.ts) — the ts/tsx the CORE generator emits
    // outside a bounded context. It does NOT additionally regenerate a
    // bounded-context's own stub source (entities/ports/adapters via
    // generateStubs + SyncEngine); that path was independently verified
    // clean against this config by a live SyncEngine run during review
    // (2 contexts, 6 ts files, `prettier --check` reported all clean) and is
    // unaffected by anything this lane changed. Add-on templates
    // (packages/template-engine/templates/*/files/**) are OUT of scope —
    // see the PR body for the measured, unfixed count.
    it("yarn format on a freshly generated project produces no diff (DoD — ts/tsx, the glob the format script actually targets)", async () => {
      await withTempWorkspace(async ({ workspaceRoot }) => {
        const ALL_FRAMEWORKS: AppFramework[] = [
          "next.js",
          "fastify",
          "plain-ts",
          "nitro",
          "express",
          "nestjs",
          "serverless",
          "vue",
          "react-router",
          "remix",
          "angular",
        ];
        const manifest: Manifest = {
          system: "no-diff-ts-project",
          scope: "no-diff-ts-project",
          apps: ALL_FRAMEWORKS.map((framework, i) => ({
            name: `app${i}`,
            framework,
          })),
          generator: { sync: { apps: { enabled: true } } },
        };

        const rootResult = await generateRootFiles(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );
        assert.strictEqual(
          rootResult.error,
          undefined,
          "generateRootFiles must not error",
        );

        const appsResult = await generateApps(
          makeConfig(workspaceRoot, manifest, { forceRoot: true }),
        );
        assert.strictEqual(
          appsResult.error,
          undefined,
          "generateApps must not error",
        );
        assert.ok(
          appsResult.created.length > 0,
          "generateApps must have created at least one file — an empty run would make this test vacuous",
        );

        const prettierrcPath = path.join(workspaceRoot, ".prettierrc.json");
        await assertPrettierCleanGlob(
          workspaceRoot,
          "**/*.{ts,tsx}",
          prettierrcPath,
        );
      });
    });
  });
});
