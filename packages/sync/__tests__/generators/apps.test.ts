import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateApps } from "../../src/generators/apps.js";
import type { App, AppFramework, Manifest } from "../../src/types/manifest.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";

/**
 * Tests for `packages/sync/src/generators/apps.ts`
 * (sync-engine-unified-scaffolding plan §Phase 3).
 *
 * Coverage:
 *   1.  No-op when manifest.apps is absent or empty
 *   2.  Creates Next.js app (package.json + tsconfig.json + src/app/page.tsx)
 *   3.  Creates Fastify app (entry at src/index.ts)
 *   4.  Creates plain-ts app (minimal scaffold)
 *   5.  Unknown framework logs error + skips that app, sync continues
 *   6.  Dedup on name: first-wins
 *   7.  Manifest override takes precedence over built-in
 *   8.  Existing hand-written app files preserved
 *   9.  depends_on embedded in package.json via {depends_on} placeholder
 *   10. Interpolates {appName}, {system}, {version}, {depends_on}
 *   11. App tsConfig written as JSON (structured, not template string)
 *
 * Governance:
 *   - Every test runs inside a disposable temp workspace (os.tmpdir()).
 *   - Host repo is never mutated.
 */

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

/**
 * Capturing logger: records error/warn messages so tests can assert on
 * observable side effects of the generator's error-handling paths.
 */
interface CapturedLogger extends LoggerPort {
  errors: string[];
  warnings: string[];
}

function makeCapturingLogger(): CapturedLogger {
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    errors,
    warnings,
    error: (msg) => {
      errors.push(msg);
    },
    warn: (msg) => {
      warnings.push(msg);
    },
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
}

/**
 * Recording ReportRecorder — accepts the same shape the generator expects
 * and stores every call for later assertion.
 */
interface RecordedReport {
  calls: Array<{ type: string; target: string; message: string }>;
  record: (type: string, target: string, message: string) => void;
}

function makeReport(): RecordedReport {
  const calls: Array<{ type: string; target: string; message: string }> = [];
  return {
    calls,
    record: (type, target, message) => {
      calls.push({ type, target, message });
    },
  };
}

function makeConfig(
  workspaceRoot: string,
  manifest: Manifest,
  logger: LoggerPort,
): SyncConfig {
  return {
    dryRun: false,
    force: false,
    forceRoot: false,
    allowDirty: false,
    strict: false,
    mode: "external",
    logger,
    manifest,
    workspaceRoot,
  };
}

/**
 * Run a callback inside a disposable temp workspace. The workspace is
 * removed unconditionally on exit — the host repo is never touched.
 */
async function withTempWorkspace(
  fn: (ctx: { workspaceRoot: string }) => Promise<void>,
) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-apps-test-"),
  );
  try {
    await fn({ workspaceRoot });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function pathExists(filePath: string): Promise<boolean> {
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
  console.log("Running apps generator tests...\n");

  // ---------------------------------------------------------------------------
  // 1) No-op when manifest.apps is absent or empty
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();

    // 1a) apps absent entirely
    const absentConfig = makeConfig(workspaceRoot, {} as Manifest, logger);
    const absentResult = await generateApps(absentConfig);
    assert.strictEqual(
      absentResult.created.length,
      0,
      "absent apps → no files created",
    );
    assert.strictEqual(
      absentResult.updated.length,
      0,
      "absent apps → no files updated",
    );
    assert.strictEqual(
      absentResult.skipped.length,
      0,
      "absent apps → no files skipped",
    );
    assert.strictEqual(
      absentResult.totalOps,
      0,
      "absent apps → totalOps === 0",
    );
    assert.strictEqual(
      absentResult.error,
      undefined,
      "absent apps → no error set",
    );

    // 1b) apps present but empty
    const emptyConfig = makeConfig(
      workspaceRoot,
      { apps: [] } as Manifest,
      logger,
    );
    const emptyResult = await generateApps(emptyConfig);
    assert.strictEqual(
      emptyResult.totalOps,
      0,
      "empty apps array → totalOps === 0",
    );
    assert.strictEqual(
      emptyResult.error,
      undefined,
      "empty apps array → no error set",
    );

    // No apps/ directory should have been created at the workspace root.
    const appsDirExists = await pathExists(path.join(workspaceRoot, "apps"));
    assert.strictEqual(
      appsDirExists,
      false,
      "no-op must not create apps/ directory",
    );

    console.log(
      "✅ No-op when manifest.apps is absent or empty (no writes, no errors)",
    );
  });

  // ---------------------------------------------------------------------------
  // 2) Creates Next.js app
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();
    const manifest: Manifest = {
      system: "myorg",
      apps: [{ name: "web", framework: "next.js" }],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);

    assert.strictEqual(result.error, undefined, "no error on happy path");
    assert.strictEqual(
      result.created.length,
      3,
      "next.js app produces exactly 3 files (package.json, tsconfig.json, entry)",
    );

    const appDir = path.join(workspaceRoot, "apps", "web");
    const pkgPath = path.join(appDir, "package.json");
    const tsPath = path.join(appDir, "tsconfig.json");
    const entryPath = path.join(appDir, "src", "app", "page.tsx");

    assert.strictEqual(await pathExists(pkgPath), true, "package.json written");
    assert.strictEqual(await pathExists(tsPath), true, "tsconfig.json written");
    assert.strictEqual(
      await pathExists(entryPath),
      true,
      "src/app/page.tsx written (Next.js entry)",
    );

    const pkg = await readJson(pkgPath);
    assert.strictEqual(
      pkg.name,
      "@myorg/web",
      "package.json name uses {system}/{appName}",
    );
    const deps = pkg.dependencies as Record<string, string>;
    assert.ok(deps.next, "next.js dependency present");
    assert.ok(deps.react, "react dependency present");

    console.log(
      "✅ Creates Next.js app: package.json + tsconfig.json + src/app/page.tsx",
    );
  });

  // ---------------------------------------------------------------------------
  // 3) Creates Fastify app
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();
    const manifest: Manifest = {
      system: "myorg",
      apps: [{ name: "api", framework: "fastify" }],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);

    assert.strictEqual(result.error, undefined, "no error on fastify app");
    const appDir = path.join(workspaceRoot, "apps", "api");
    const pkgPath = path.join(appDir, "package.json");
    const entryPath = path.join(appDir, "src", "index.ts");

    assert.strictEqual(
      await pathExists(pkgPath),
      true,
      "fastify package.json written",
    );
    assert.strictEqual(
      await pathExists(entryPath),
      true,
      "fastify entry at src/index.ts",
    );
    // Should NOT write a Next.js-style entry
    const nextEntryExists = await pathExists(
      path.join(appDir, "src", "app", "page.tsx"),
    );
    assert.strictEqual(
      nextEntryExists,
      false,
      "fastify must not write Next.js entry",
    );

    const pkg = await readJson(pkgPath);
    const deps = pkg.dependencies as Record<string, string>;
    assert.ok(deps.fastify, "fastify dependency present");
    assert.strictEqual(
      "next" in deps,
      false,
      "fastify package.json must not contain next dependency",
    );

    const entryContent = await readText(entryPath);
    assert.ok(
      entryContent.includes("fastify"),
      "fastify entry references the fastify module",
    );

    console.log(
      "✅ Creates Fastify app: package.json + src/index.ts (no next/page.tsx)",
    );
  });

  // ---------------------------------------------------------------------------
  // 4) Creates plain-ts app (minimal scaffold)
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();
    const manifest: Manifest = {
      system: "myorg",
      apps: [{ name: "cli", framework: "plain-ts" }],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);

    assert.strictEqual(result.error, undefined, "no error on plain-ts app");
    const appDir = path.join(workspaceRoot, "apps", "cli");
    const pkgPath = path.join(appDir, "package.json");
    const entryPath = path.join(appDir, "src", "index.ts");

    assert.strictEqual(
      await pathExists(pkgPath),
      true,
      "plain-ts package.json written",
    );
    assert.strictEqual(
      await pathExists(entryPath),
      true,
      "plain-ts entry at src/index.ts",
    );

    const pkg = await readJson(pkgPath);
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    // Minimal scaffold: no framework runtime deps, just TS devDeps.
    assert.strictEqual(
      "next" in deps,
      false,
      "plain-ts must not carry next dep",
    );
    assert.strictEqual(
      "fastify" in deps,
      false,
      "plain-ts must not carry fastify dep",
    );
    const devDeps = pkg.devDependencies as Record<string, string>;
    assert.ok(devDeps.typescript, "plain-ts carries typescript devDep");

    console.log(
      "✅ Creates plain-ts app: minimal scaffold (package.json + src/index.ts, no framework deps)",
    );
  });

  // ---------------------------------------------------------------------------
  // 5) Unknown framework logs error + skips that app; sync continues
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();
    const report = makeReport();
    // "remix" is not in the AppFramework union; cast reflects the intent to
    // probe the runtime fallback path (unknown framework, no manifest template).
    const manifest: Manifest = {
      system: "myorg",
      apps: [
        { name: "legacy", framework: "remix" as AppFramework },
        { name: "api", framework: "fastify" },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config, report);

    assert.strictEqual(
      result.error,
      undefined,
      "unknown framework must not abort sync",
    );

    // No files written for the unknown-framework app.
    const legacyDirExists = await pathExists(
      path.join(workspaceRoot, "apps", "legacy"),
    );
    // The generator `mkdir`s the app directory BEFORE resolving the template,
    // so presence of the directory is not diagnostic. What matters is that no
    // files (package.json / tsconfig.json / entry) were written.
    if (legacyDirExists) {
      const legacyPkg = path.join(
        workspaceRoot,
        "apps",
        "legacy",
        "package.json",
      );
      assert.strictEqual(
        await pathExists(legacyPkg),
        false,
        "unknown framework must not write package.json",
      );
    }

    // The sibling app still processed.
    const apiPkg = path.join(workspaceRoot, "apps", "api", "package.json");
    assert.strictEqual(
      await pathExists(apiPkg),
      true,
      "sibling fastify app is still generated after unknown-framework error",
    );

    // log.error fired for the unknown framework.
    const errorFired = logger.errors.some(
      (m) => m.includes("legacy") && m.includes("remix"),
    );
    assert.strictEqual(
      errorFired,
      true,
      `expected logger.error to mention "legacy" and "remix" — got: ${JSON.stringify(
        logger.errors,
      )}`,
    );

    // Report recorder received the structured "blocked" entry.
    const blockedForLegacy = report.calls.find(
      (c) => c.type === "blocked" && c.target === "legacy",
    );
    assert.ok(
      blockedForLegacy,
      "report recorder must receive a 'blocked' entry for the unknown-framework app",
    );

    console.log(
      "✅ Unknown framework logs error + skips that app; sync continues for siblings",
    );
  });

  // ---------------------------------------------------------------------------
  // 6) Dedup on name: first-wins
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();
    const manifest: Manifest = {
      system: "myorg",
      apps: [
        { name: "web", framework: "next.js" },
        { name: "web", framework: "fastify" }, // duplicate — must be skipped
      ],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);
    assert.strictEqual(result.error, undefined, "dedup must not set error");

    const pkgPath = path.join(workspaceRoot, "apps", "web", "package.json");
    const pkg = await readJson(pkgPath);
    const deps = pkg.dependencies as Record<string, string>;

    // First occurrence (next.js) wins — must contain `next`, NOT `fastify`.
    assert.ok(
      deps.next,
      "first-wins dedup: Next.js dependencies retained from first occurrence",
    );
    assert.strictEqual(
      "fastify" in deps,
      false,
      "first-wins dedup: Fastify dependencies from duplicate must NOT overwrite",
    );

    // Only Next.js-shaped entry exists.
    const nextEntryExists = await pathExists(
      path.join(workspaceRoot, "apps", "web", "src", "app", "page.tsx"),
    );
    assert.strictEqual(
      nextEntryExists,
      true,
      "first-wins: Next.js entry path was used",
    );

    // A warning about the duplicate was logged.
    const duplicateWarned = logger.warnings.some(
      (m) => m.includes("duplicate") && m.includes("web"),
    );
    assert.strictEqual(
      duplicateWarned,
      true,
      `expected logger.warn to flag duplicate "web" — got: ${JSON.stringify(
        logger.warnings,
      )}`,
    );

    console.log(
      '✅ Dedup on name: first-wins (duplicate "web" skipped with warning)',
    );
  });

  // ---------------------------------------------------------------------------
  // 7) Manifest override takes precedence over built-in
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();

    // Custom package.json template — a distinctive shape we can assert on.
    const customPkgTemplate = `{
  "name": "@{system}/{appName}",
  "version": "9.9.9",
  "private": true,
  "custom": "override-marker",
  "dependencies": {
    "custom-runtime": "^1.0.0"
  }
}
`;

    const manifest: Manifest = {
      system: "myorg",
      generator: {
        sync: {
          apps: {
            frameworks: {
              "next.js": {
                packageJson: { template: customPkgTemplate },
              },
            },
          },
        },
      },
      apps: [{ name: "web", framework: "next.js" }],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);
    assert.strictEqual(
      result.error,
      undefined,
      "manifest override must not fail",
    );

    const pkg = await readJson(
      path.join(workspaceRoot, "apps", "web", "package.json"),
    );
    assert.strictEqual(
      pkg.custom,
      "override-marker",
      "manifest override's custom field must appear (built-in does not have it)",
    );
    assert.strictEqual(
      pkg.version,
      "9.9.9",
      "manifest override's version must win over built-in (0.0.0)",
    );
    const deps = pkg.dependencies as Record<string, string>;
    assert.ok(
      deps["custom-runtime"],
      "manifest override's custom-runtime dep must be present",
    );
    assert.strictEqual(
      "next" in deps,
      false,
      "built-in next dep must be replaced by override (package.json is a whole-field override)",
    );

    // tsConfig and entryPoint were NOT overridden → fall through to built-in.
    const tsConfig = await readJson(
      path.join(workspaceRoot, "apps", "web", "tsconfig.json"),
    );
    const compilerOptions = tsConfig.compilerOptions as Record<string, unknown>;
    assert.strictEqual(
      compilerOptions.jsx,
      "react-jsx",
      "non-overridden tsConfig fields fall through to the Next.js built-in",
    );
    const builtInEntryExists = await pathExists(
      path.join(workspaceRoot, "apps", "web", "src", "app", "page.tsx"),
    );
    assert.strictEqual(
      builtInEntryExists,
      true,
      "non-overridden entryPoint falls through to built-in path",
    );

    console.log(
      "✅ Manifest override takes precedence over built-in (custom fields win, non-overridden fields fall through)",
    );
  });

  // ---------------------------------------------------------------------------
  // 8) Existing app files preserved (non-generated content)
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();

    const appDir = path.join(workspaceRoot, "apps", "web");
    await fs.mkdir(appDir, { recursive: true });

    const handWrittenPkg = `{
  "name": "@myorg/web",
  "version": "1.2.3",
  "private": true,
  "description": "Hand-written, do not overwrite",
  "dependencies": {
    "hand-written-dep": "^0.0.1"
  }
}
`;
    const pkgPath = path.join(appDir, "package.json");
    await fs.writeFile(pkgPath, handWrittenPkg, "utf8");

    const manifest: Manifest = {
      system: "myorg",
      apps: [{ name: "web", framework: "next.js" }],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);
    assert.strictEqual(
      result.error,
      undefined,
      "preserving existing files must not set error",
    );

    // The pre-existing package.json must appear in `skipped`.
    assert.ok(
      result.skipped.includes(pkgPath),
      `expected pre-existing package.json in skipped list — got: ${JSON.stringify(
        result.skipped,
      )}`,
    );

    // Content must be byte-identical (safeWriteFileAtomic refused to rewrite it).
    const actual = await readText(pkgPath);
    assert.strictEqual(
      actual,
      handWrittenPkg,
      "hand-written package.json content must be preserved verbatim",
    );

    // tsconfig.json and the Next.js entry (neither pre-existing) are still created.
    assert.ok(
      await pathExists(path.join(appDir, "tsconfig.json")),
      "tsconfig.json is still generated when only package.json is hand-written",
    );
    assert.ok(
      await pathExists(path.join(appDir, "src", "app", "page.tsx")),
      "entry point is still generated when only package.json is hand-written",
    );

    console.log(
      "✅ Existing hand-written app files preserved (reported as skipped, content untouched)",
    );
  });

  // ---------------------------------------------------------------------------
  // 9) depends_on embedded in package.json when template uses {depends_on}
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();

    // Manifest-supplied template that references {depends_on}. The built-in
    // Next.js template does not, so we override to exercise this path.
    const depsAwareTemplate = `{
  "name": "@{system}/{appName}",
  "version": "0.0.0",
  "private": true,
  "hexagenDependsOn": "{depends_on}",
  "dependencies": {}
}
`;

    const manifest: Manifest = {
      system: "myorg",
      generator: {
        sync: {
          apps: {
            frameworks: {
              "next.js": {
                packageJson: { template: depsAwareTemplate },
              },
            },
          },
        },
      },
      apps: [
        {
          name: "web",
          framework: "next.js",
          depends_on: ["shared", "messaging"],
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);
    assert.strictEqual(result.error, undefined);

    const pkg = await readJson(
      path.join(workspaceRoot, "apps", "web", "package.json"),
    );
    assert.strictEqual(
      pkg.hexagenDependsOn,
      "shared, messaging",
      "depends_on must be joined with ', ' and substituted for {depends_on}",
    );

    console.log(
      "✅ depends_on embedded in package.json when template uses {depends_on} placeholder",
    );
  });

  // ---------------------------------------------------------------------------
  // 10) Interpolates {appName}, {system}, {version}, {depends_on}
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();

    const fullInterpolationTemplate = `{
  "name": "@{system}/{appName}",
  "appName": "{appName}",
  "system": "{system}",
  "version": "{version}",
  "depends_on": "{depends_on}",
  "private": true,
  "dependencies": {}
}
`;

    const manifest: Manifest = {
      system: "acme",
      generator: {
        sync: {
          apps: {
            frameworks: {
              "plain-ts": {
                packageJson: { template: fullInterpolationTemplate },
              },
            },
          },
        },
      },
      apps: [
        {
          name: "tool",
          framework: "plain-ts",
          version: "2.4.1",
          depends_on: ["core-domain", "shared"],
        } as App,
      ],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);
    assert.strictEqual(result.error, undefined, "interpolation must not error");

    const pkg = await readJson(
      path.join(workspaceRoot, "apps", "tool", "package.json"),
    );
    assert.strictEqual(pkg.name, "@acme/tool", "{system}/{appName} expanded");
    assert.strictEqual(pkg.appName, "tool", "{appName} expanded");
    assert.strictEqual(pkg.system, "acme", "{system} expanded");
    assert.strictEqual(
      pkg.version,
      "2.4.1",
      "{version} expanded from app.version",
    );
    assert.strictEqual(
      pkg.depends_on,
      "core-domain, shared",
      "{depends_on} expanded as comma-joined list",
    );

    // No warnings should have fired — every placeholder resolved.
    const unresolvedWarning = logger.warnings.find((m) =>
      m.includes("unresolved template placeholder"),
    );
    assert.strictEqual(
      unresolvedWarning,
      undefined,
      `no unresolved-placeholder warnings expected, got: ${JSON.stringify(
        logger.warnings,
      )}`,
    );

    console.log("✅ Interpolates {appName}, {system}, {version}, {depends_on}");
  });

  // ---------------------------------------------------------------------------
  // 11) App tsConfig written as JSON (structured, not template string)
  // ---------------------------------------------------------------------------
  await withTempWorkspace(async ({ workspaceRoot }) => {
    const logger = makeCapturingLogger();
    const manifest: Manifest = {
      system: "myorg",
      apps: [{ name: "web", framework: "next.js" }],
    };
    const config = makeConfig(workspaceRoot, manifest, logger);

    const result = await generateApps(config);
    assert.strictEqual(result.error, undefined);

    const tsPath = path.join(workspaceRoot, "apps", "web", "tsconfig.json");
    const raw = await readText(tsPath);

    // Must be valid JSON — parseable without error. Template strings with
    // unresolved placeholders would throw here.
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.fail(
        `tsconfig.json must be valid JSON (structured serialization), got parse error: ${message}\nContent:\n${raw}`,
      );
    }

    // Structured fields from NEXTJS_TSCONFIG must be present verbatim —
    // confirming JSON.stringify(tsConfig, null, 2) rather than
    // template-interpolate(rawString) was used.
    assert.strictEqual(
      parsed.extends,
      "../../tsconfig.base.json",
      "tsConfig.extends preserved structurally",
    );
    const compilerOptions = parsed.compilerOptions as Record<string, unknown>;
    assert.strictEqual(
      compilerOptions.jsx,
      "react-jsx",
      "compilerOptions.jsx preserved as a real JSON string",
    );
    assert.strictEqual(
      compilerOptions.composite,
      true,
      "compilerOptions.composite preserved as a real JSON boolean (not stringified)",
    );
    assert.deepStrictEqual(
      parsed.include,
      ["src/**/*"],
      "include array preserved as real JSON array",
    );

    // Template placeholders must NOT leak into the tsconfig (it's serialized
    // via JSON.stringify, not via the template engine).
    assert.strictEqual(
      raw.includes("{appName}"),
      false,
      "tsconfig.json must not contain template placeholders",
    );
    assert.strictEqual(
      raw.includes("{system}"),
      false,
      "tsconfig.json must not contain template placeholders",
    );

    console.log(
      "✅ App tsConfig written as JSON (structured JSON.stringify, not template interpolation)",
    );
  });

  console.log("\n✅ All apps generator tests passed!");
})().catch((err) => {
  console.error("❌ apps generator tests FAILED:", err);
  process.exitCode = 1;
});
