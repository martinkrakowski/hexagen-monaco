import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRootFiles } from "../../src/generators/root-files.js";
import type { Manifest } from "../../src/types/manifest.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";

/**
 * Tests for `packages/sync/src/generators/root-files.ts`.
 *
 * Scope: the three root files emitted by `generateRootFiles`
 *   - `<workspaceRoot>/package.json`
 *   - `<workspaceRoot>/tsconfig.base.json`
 *   - `<workspaceRoot>/turbo.json`
 *
 * Covered:
 *   1. Clean creation of all three files when none exist
 *   2. Manifest-supplied `monorepo.rootFiles.packageJson.template`
 *      takes precedence over the built-in
 *   3. Built-in fallback kicks in when the manifest does not declare a
 *      `rootFiles` section at all
 *   4. `{system}`, `{scope}`, `{packageManager}`, `{workspaces}` interpolation
 *   5. Root-protection: `turbo.json` (the one member of the trio in
 *      `protectedFiles`) is NOT overwritten without `--force-root`
 *   6. `--force-root` does overwrite the protected `turbo.json`
 *   7. Identical content → `safeWriteFileAtomic` returns `unchanged`,
 *      so the file appears in none of `result.created / updated / skipped`
 *   8. Unresolved `{missingVar}` placeholders trigger a `logger.warn` call
 *      with the variable name surfaced
 *
 * Real execution is exercised throughout: we never set `dryRun: true`.
 * `fs-utils.ts:91-115` shows that the dry-run branch fires BEFORE the
 * protection / skipGeneratedCheck checks, so dry-run predictions do NOT
 * reflect actual on-disk outcomes.
 */

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

/** No-op logger that satisfies LoggerPort without cluttering test output. */
const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

/**
 * Spy logger: records every `warn` invocation so tests can assert on the
 * presence, count, and content of warnings surfaced by the generator.
 */
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

/**
 * Build a minimal SyncConfig suitable for driving generateRootFiles against
 * a temp workspace. `forceRoot` and `force` default to false so protection
 * behaviour is exercised by default.
 */
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

/**
 * Run a callback inside a disposable temp workspace and always clean up.
 * Intentionally does NOT touch the host repo — each test gets a fresh
 * `os.tmpdir()` subtree.
 */
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

// -----------------------------------------------------------------------------
// Test cases
// -----------------------------------------------------------------------------

(async () => {
  console.log("Running root-files generator tests...\n");

  // ---------------------------------------------------------------------------
  // 1) Clean creation: all three root files are written when none exist
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const manifest: Manifest = { system: "test-project" };
    // turbo.json is in `protectedFiles`; without forceRoot it would be
    // reported as "protected" even on an empty directory, because the
    // protection check in `safeWriteFileAtomic` fires regardless of whether
    // the target already exists. External-mode generation sets forceRoot.
    const config = makeConfig(workspaceRoot, manifest, { forceRoot: true });

    const result = await generateRootFiles(config);

    assert.strictEqual(
      result.error,
      undefined,
      "generator must not report an error on a clean temp dir",
    );
    assert.strictEqual(
      result.created.length,
      3,
      "should report three created files (package.json, tsconfig.base.json, turbo.json)",
    );
    assert.strictEqual(result.updated.length, 0);
    assert.strictEqual(result.skipped.length, 0);
    assert.strictEqual(result.totalOps, 3);

    for (const name of ["package.json", "tsconfig.base.json", "turbo.json"]) {
      const p = path.join(workspaceRoot, name);
      assert.strictEqual(
        await fileExists(p),
        true,
        `${name} must exist after generation`,
      );
      const content = await readFile(p);
      // Every file must be syntactically valid JSON — the built-in
      // templates are JSON blobs after interpolation.
      assert.doesNotThrow(
        () => JSON.parse(content),
        `${name} must be valid JSON after interpolation`,
      );
    }

    // Built-in package.json must contain the system name we supplied.
    const pkg = JSON.parse(
      await readFile(path.join(workspaceRoot, "package.json")),
    ) as Record<string, unknown>;
    assert.strictEqual(
      pkg.name,
      "test-project",
      "built-in package.json must interpolate {system} into `name`",
    );

    console.log(
      "✅ generateRootFiles creates package.json, tsconfig.base.json, and turbo.json on a clean temp dir",
    );
  });

  // ---------------------------------------------------------------------------
  // 2) Manifest `rootFiles.packageJson.template` overrides the built-in
  // ---------------------------------------------------------------------------
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
    // Sanity: the built-in has a `workspaces` key; the custom template does not.
    assert.strictEqual(
      content.includes("workspaces"),
      false,
      "built-in must NOT have leaked through when manifest provides a template",
    );

    console.log(
      "✅ generateRootFiles uses manifest monorepo.rootFiles.packageJson.template when present",
    );
  });

  // ---------------------------------------------------------------------------
  // 3) Built-in fallback: manifest lacks a `rootFiles` section
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const manifest: Manifest = {
      system: "fallback-project",
      // No `monorepo` block at all — generator must fall back to built-ins.
    };
    const config = makeConfig(workspaceRoot, manifest, { forceRoot: true });

    await generateRootFiles(config);

    const pkg = await readFile(path.join(workspaceRoot, "package.json"));
    // The built-in package.json template hard-codes a `"turbo": "turbo build"`
    // script and declares turbo / typescript / eslint / prettier devDeps.
    assert.ok(
      pkg.includes(`"build": "turbo build"`),
      "built-in package.json must include the turbo build script",
    );
    assert.ok(
      pkg.includes(`"@hexagen/sync"`),
      "built-in package.json must include @hexagen/sync in devDependencies",
    );

    const tsconfig = await readFile(
      path.join(workspaceRoot, "tsconfig.base.json"),
    );
    assert.ok(
      tsconfig.includes(`"moduleResolution": "bundler"`),
      "built-in tsconfig.base.json must declare moduleResolution=bundler",
    );

    const turbo = await readFile(path.join(workspaceRoot, "turbo.json"));
    assert.ok(
      turbo.includes(`"$schema": "https://turbo.build/schema.json"`),
      "built-in turbo.json must include the turbo schema pointer",
    );

    console.log(
      "✅ generateRootFiles falls back to built-in templates when manifest has no rootFiles section",
    );
  });

  // ---------------------------------------------------------------------------
  // 4) Interpolation of {system}, {scope}, {packageManager}, {workspaces}
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const template = `{
  "system": "{system}",
  "scope": "{scope}",
  "packageManager": "{packageManager}",
  "workspaces": {workspaces}
}`;
    const manifest: Manifest = {
      system: "my-app",
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
    // System + scope + packageManager: scalar substitutions.
    assert.ok(
      content.includes(`"system": "my-app"`),
      "{system} must be interpolated into the template",
    );
    assert.ok(
      content.includes(`"scope": "@my-scope"`),
      "{scope} must be interpolated into the template",
    );
    assert.ok(
      content.includes(`"packageManager": "pnpm@9.0.0"`),
      "{packageManager} must be interpolated into the template",
    );
    // {workspaces} is a pre-stringified JSON fragment — confirm the
    // resulting document parses and the array has the right members.
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

    console.log(
      "✅ generateRootFiles interpolates {system}, {scope}, {packageManager}, and {workspaces}",
    );
  });

  // ---------------------------------------------------------------------------
  // 5) Protection: existing turbo.json with different content is NOT
  //    overwritten when forceRoot=false.
  //
  //    Note: of the three generated files, only `turbo.json` is listed in
  //    `protectedFiles` in fs-utils.ts. `package.json` and
  //    `tsconfig.base.json` are not root-protected — they would be written
  //    freely even with `forceRoot: false` because `writeRootFile` passes
  //    `skipGeneratedCheck=true` and thus bypasses the non-generated
  //    protection branch as well. The module-level docstring in
  //    root-files.ts that claims "all three root files are listed in
  //    protectedFiles" is inaccurate.
  // ---------------------------------------------------------------------------
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

    console.log(
      "✅ generateRootFiles does NOT overwrite protected turbo.json without --force-root",
    );
  });

  // ---------------------------------------------------------------------------
  // 6) `--force-root` overwrites the protected turbo.json
  // ---------------------------------------------------------------------------
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

    console.log(
      "✅ generateRootFiles overwrites protected turbo.json when --force-root is set",
    );
  });

  // ---------------------------------------------------------------------------
  // 7) Identical content → `unchanged` status, no write occurs.
  //
  //    The generator does not expose an explicit "unchanged" bucket in
  //    GeneratorResult — `safeWriteFileAtomic` returns "unchanged" and
  //    writeRootFile simply ignores it. We assert on the INDIRECT evidence:
  //    the file does not appear in any bucket and its mtime is unchanged.
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    // Step 1: run once with forceRoot so all three files are written from
    // the built-in templates and land on disk in their canonical form.
    const manifest: Manifest = { system: "idem-project" };
    const firstPassConfig = makeConfig(workspaceRoot, manifest, {
      forceRoot: true,
    });
    await generateRootFiles(firstPassConfig);

    const pkgPath = path.join(workspaceRoot, "package.json");
    const firstMtime = (await fs.stat(pkgPath)).mtimeMs;

    // Capture the exact on-disk content for byte-identity verification.
    const firstContent = await readFile(pkgPath);

    // Small delay so mtime would observably change if a write did occur.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Step 2: re-run with forceRoot=false. Because the file on disk already
    // matches what the generator would produce, safeWriteFileAtomic returns
    // "unchanged" before any protection check is reached.
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

    console.log(
      "✅ generateRootFiles performs no write when content hash matches (unchanged status)",
    );
  });

  // ---------------------------------------------------------------------------
  // 8) Missing variables produce interpolation warnings via `logger.warn`
  // ---------------------------------------------------------------------------
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

    // The generator must have surfaced a warning naming the missing variable
    // and tagged the file label.
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

    // The generator deliberately leaves unresolved placeholders in the output
    // rather than blanking them (see template-engine.ts). Confirm the file
    // still reflects that policy so future changes to either module don't
    // silently diverge.
    const content = await readFile(path.join(workspaceRoot, "package.json"));
    assert.ok(
      content.includes("{missingVar}"),
      "unresolved placeholder must remain in the output verbatim",
    );
    assert.ok(
      content.includes(`"name":"has-a-system"`),
      "resolved placeholders must still be interpolated alongside unresolved ones",
    );

    console.log(
      "✅ generateRootFiles emits logger.warn for unresolved template variables and leaves them in the output",
    );
  });

  console.log("\n✅ All root-files generator tests passed!");
})().catch((err) => {
  console.error("❌ root-files generator tests FAILED:", err);
  process.exitCode = 1;
});
