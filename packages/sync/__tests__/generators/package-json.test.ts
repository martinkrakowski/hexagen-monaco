import { describe, it } from "node:test";
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

const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

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

describe("package json", () => {
  it("should return empty object when depends_on is undefined", async () => {
    const ctx: BoundedContext = { name: "foo" };
    assert.deepStrictEqual(
      expandDependsOn(ctx, "acme"),
      {},
      "expandDependsOn should return {} when depends_on is undefined",
    );
  });

  it("should return empty object when depends_on is empty array", async () => {
    const ctx: BoundedContext = { name: "foo", depends_on: [] };
    assert.deepStrictEqual(
      expandDependsOn(ctx, "acme"),
      {},
      "expandDependsOn should return {} when depends_on is empty array",
    );
  });

  it("should map depends_on names to workspace:* entries", async () => {
    const ctx: BoundedContext = {
      name: "foo",
      depends_on: ["shared", "messaging"],
    };
    assert.deepStrictEqual(
      expandDependsOn(ctx, "acme"),
      {
        "@acme/shared": "workspace:*",
        "@acme/messaging": "workspace:*",
      },
      "expandDependsOn should map each name to @<scope>/<name>: workspace:*",
    );
  });

  it("should inject workspace deps from depends_on for new package", async () => {
    await withTempWorkspace("test-pkg", async ({ workspaceRoot, pkgPath }) => {
      const manifest: Manifest = {
        scope: "acme",
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
      assert.strictEqual(
        pkg.name,
        "@acme/test-pkg",
        "package name must use the manifest scope, not @hexagen",
      );
      const deps = pkg.dependencies as Record<string, string>;
      assert.deepStrictEqual(
        deps,
        { "@acme/shared": "workspace:*" },
        "new package.json should include @acme/shared from depends_on",
      );
    });
  });

  it("should preserve existing dependencies and not merge depends_on", async () => {
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
          scope: "acme",
          bounded_contexts: [{ name: "existing-pkg", depends_on: ["shared"] }],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generatePackageJson(
          path.dirname(pkgPath),
          "existing-pkg",
          config,
        );

        const pkg = await readJson(pkgPath);
        const deps = pkg.dependencies as Record<string, string>;
        assert.deepStrictEqual(
          deps,
          { lodash: "^4.0.0" },
          "existing dependencies must be preserved verbatim (protectedKeys behavior)",
        );
        assert.strictEqual(
          "@acme/shared" in deps,
          false,
          "depends_on entries must NOT be merged into existing dependencies (Phase 1 zero-behavior-change guarantee)",
        );
      },
    );
  });

  it("should inject exports field for new package", async () => {
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
      },
    );
  });

  it("should preserve existing exports field", async () => {
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
      },
    );
  });
});
