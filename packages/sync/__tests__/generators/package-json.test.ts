import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePackageJson } from "../../src/generators/package-json.js";
import {
  expandDependsOn,
  type BoundedContext,
  type Manifest,
} from "../../src/types/manifest.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";

/**
 * Tests for ADR-0024 Phase 1.2 + 1.3:
 *   - expandDependsOn helper (types/manifest.ts)
 *   - package-json generator consumes depends_on → workspace deps
 *   - package-json generator emits `exports` field when missing
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
 * Build a minimal SyncConfig suitable for driving generatePackageJson
 * against a temp workspace.
 */
function makeConfig(workspaceRoot: string, manifest: Manifest): SyncConfig {
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
  };
}

/**
 * Run a callback inside a disposable temp workspace that contains
 * a single package directory at packages/<moduleName>/. Cleans up
 * the directory on exit.
 */
async function withTempWorkspace(
  moduleName: string,
  fn: (ctx: {
    workspaceRoot: string;
    modulePath: string;
    pkgPath: string;
  }) => Promise<void>,
) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-pkgjson-test-"),
  );
  const modulePath = path.join(workspaceRoot, "packages", moduleName);
  await fs.mkdir(modulePath, { recursive: true });
  const pkgPath = path.join(modulePath, "package.json");
  try {
    await fn({ workspaceRoot, modulePath, pkgPath });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Test cases
// -----------------------------------------------------------------------------

(async () => {
  console.log("Running package-json generator tests...\n");

  // ---------------------------------------------------------------------------
  // expandDependsOn unit tests
  // ---------------------------------------------------------------------------

  // 1) undefined depends_on → empty object
  {
    const ctx: BoundedContext = { name: "foo" };
    assert.deepStrictEqual(
      expandDependsOn(ctx),
      {},
      "expandDependsOn should return {} when depends_on is undefined",
    );
    console.log(
      "✅ expandDependsOn returns empty object when depends_on is undefined",
    );
  }

  // 2) empty depends_on array → empty object
  {
    const ctx: BoundedContext = { name: "foo", depends_on: [] };
    assert.deepStrictEqual(
      expandDependsOn(ctx),
      {},
      "expandDependsOn should return {} when depends_on is empty array",
    );
    console.log(
      "✅ expandDependsOn returns empty object when depends_on is empty array",
    );
  }

  // 3) populated depends_on → @hexagen/<name>: workspace:* entries
  {
    const ctx: BoundedContext = {
      name: "foo",
      depends_on: ["shared", "messaging"],
    };
    assert.deepStrictEqual(
      expandDependsOn(ctx),
      {
        "@hexagen/shared": "workspace:*",
        "@hexagen/messaging": "workspace:*",
      },
      "expandDependsOn should map each name to @hexagen/<name>: workspace:*",
    );
    console.log(
      "✅ expandDependsOn maps each name to @hexagen/<name>: workspace:*",
    );
  }

  // ---------------------------------------------------------------------------
  // generatePackageJson integration tests
  // ---------------------------------------------------------------------------

  // 4) New package (no existing package.json): depends_on → workspace deps injected
  await withTempWorkspace("test-pkg", async ({ workspaceRoot, pkgPath }) => {
    const manifest: Manifest = {
      bounded_contexts: [{ name: "test-pkg", depends_on: ["shared"] }],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generatePackageJson(
      path.dirname(pkgPath),
      "test-pkg",
      config,
    );

    assert.strictEqual(
      result.created.length,
      1,
      "generatePackageJson should report one created file for a new package",
    );

    const pkg = await readJson(pkgPath);
    const deps = pkg.dependencies as Record<string, string>;
    assert.deepStrictEqual(
      deps,
      { "@hexagen/shared": "workspace:*" },
      "new package.json should include @hexagen/shared from depends_on",
    );
    console.log(
      "✅ generatePackageJson injects workspace deps from depends_on for new package",
    );
  });

  // 5) Existing package.json with dependencies:
  //    Because `dependencies` is in protectedKeys, the existing value is preserved
  //    ENTIRELY and depends_on-derived entries are NOT merged in. This is the
  //    current merge semantics (see package-json.ts lines 83-94) and matches
  //    ADR-0024 §"Phase 1 commit: zero behavior change for existing packages".
  await withTempWorkspace(
    "existing-pkg",
    async ({ workspaceRoot, pkgPath }) => {
      const existingPkg = {
        name: "@hexagen/existing-pkg",
        version: "0.1.0",
        private: true,
        dependencies: { lodash: "^4.0.0" },
      };
      await fs.writeFile(
        pkgPath,
        JSON.stringify(existingPkg, null, 2) + "\n",
        "utf8",
      );

      const manifest: Manifest = {
        bounded_contexts: [{ name: "existing-pkg", depends_on: ["shared"] }],
      };
      const config = makeConfig(workspaceRoot, manifest);

      await generatePackageJson(path.dirname(pkgPath), "existing-pkg", config);

      const pkg = await readJson(pkgPath);
      const deps = pkg.dependencies as Record<string, string>;
      assert.deepStrictEqual(
        deps,
        { lodash: "^4.0.0" },
        "existing dependencies must be preserved verbatim (protectedKeys behavior)",
      );
      assert.strictEqual(
        "@hexagen/shared" in deps,
        false,
        "depends_on entries must NOT be merged into existing dependencies (Phase 1 zero-behavior-change guarantee)",
      );
      console.log(
        "✅ generatePackageJson preserves existing dependencies and does NOT merge depends_on into them (protectedKeys behavior)",
      );
    },
  );

  // 6) New package: exports field is injected
  await withTempWorkspace(
    "new-exports-pkg",
    async ({ workspaceRoot, pkgPath }) => {
      const manifest: Manifest = {
        bounded_contexts: [{ name: "new-exports-pkg" }],
      };
      const config = makeConfig(workspaceRoot, manifest);

      await generatePackageJson(
        path.dirname(pkgPath),
        "new-exports-pkg",
        config,
      );

      const pkg = await readJson(pkgPath);
      assert.deepStrictEqual(
        pkg.exports,
        {
          ".": {
            types: "./dist/index.d.ts",
            default: "./dist/index.js",
          },
        },
        "new package.json must contain the canonical exports block",
      );
      console.log(
        "✅ generatePackageJson injects exports field for new package",
      );
    },
  );

  // 7) Existing package.json with custom exports: preserved (protectedKeys)
  await withTempWorkspace(
    "custom-exports-pkg",
    async ({ workspaceRoot, pkgPath }) => {
      const customExports = {
        ".": {
          types: "./custom.d.ts",
          default: "./custom.js",
        },
      };
      const existingPkg = {
        name: "@hexagen/custom-exports-pkg",
        version: "0.1.0",
        private: true,
        exports: customExports,
      };
      await fs.writeFile(
        pkgPath,
        JSON.stringify(existingPkg, null, 2) + "\n",
        "utf8",
      );

      const manifest: Manifest = {
        bounded_contexts: [{ name: "custom-exports-pkg" }],
      };
      const config = makeConfig(workspaceRoot, manifest);

      await generatePackageJson(
        path.dirname(pkgPath),
        "custom-exports-pkg",
        config,
      );

      const pkg = await readJson(pkgPath);
      assert.deepStrictEqual(
        pkg.exports,
        customExports,
        "existing exports must be preserved verbatim (protectedKeys behavior)",
      );
      console.log("✅ generatePackageJson preserves existing exports field");
    },
  );

  console.log("\n✅ All package-json generator tests passed!");
})().catch((err) => {
  console.error("❌ package-json generator tests FAILED:", err);
  process.exitCode = 1;
});
