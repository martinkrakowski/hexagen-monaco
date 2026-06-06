import { describe, it } from "node:test";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import { generateApps } from "../../src/generators/apps.js";
import type { App, AppFramework, Manifest } from "../../src/types/manifest.js";
import { createSpyLogger, messagesAt } from "../helpers/spy-logger.js";
import {
  withTempWorkspace,
  pathExists,
  readText,
  readJson,
} from "../helpers/fs-helpers.js";
import { makeConfig, makeReport } from "../helpers/test-config.js";

describe("apps", () => {
  it("should produce no files when manifest.apps is absent or empty", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();

      const absentConfig = makeConfig(workspaceRoot, {} as Manifest, {
        logger,
        enableApps: true,
      });
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

      const emptyConfig = makeConfig(workspaceRoot, { apps: [] } as Manifest, {
        logger,
        enableApps: true,
      });
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

      const appsDirExists = await pathExists(path.join(workspaceRoot, "apps"));
      assert.strictEqual(
        appsDirExists,
        false,
        "no-op must not create apps/ directory",
      );
    });
  });

  it("should create Next.js app with package.json, tsconfig.json, and page.tsx", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const manifest: Manifest = {
        system: "myorg",
        apps: [{ name: "web", framework: "next.js" }],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config);

      assert.strictEqual(result.error, undefined, "no error on happy path");
      assert.strictEqual(
        result.created.length,
        3,
        "next.js app produces exactly 3 files",
      );

      const appDir = path.join(workspaceRoot, "apps", "web");
      const pkgPath = path.join(appDir, "package.json");
      const tsPath = path.join(appDir, "tsconfig.json");
      const entryPath = path.join(appDir, "src", "app", "page.tsx");

      assert.strictEqual(
        await pathExists(pkgPath),
        true,
        "package.json written",
      );
      assert.strictEqual(
        await pathExists(tsPath),
        true,
        "tsconfig.json written",
      );
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
    });
  });

  it("should create Fastify app with package.json and src/index.ts", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const manifest: Manifest = {
        system: "myorg",
        apps: [{ name: "api", framework: "fastify" }],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

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
    });
  });

  it("should create plain-ts app with minimal scaffold", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const manifest: Manifest = {
        system: "myorg",
        apps: [{ name: "cli", framework: "plain-ts" }],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

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
    });
  });

  it("should log error and skip unknown framework while continuing for siblings", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const report = makeReport();
      const manifest: Manifest = {
        system: "myorg",
        apps: [
          { name: "legacy", framework: "remix" as AppFramework },
          { name: "api", framework: "fastify" },
        ],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config, report);

      assert.strictEqual(
        result.error,
        undefined,
        "unknown framework must not abort sync",
      );

      const legacyDirExists = await pathExists(
        path.join(workspaceRoot, "apps", "legacy"),
      );
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

      const apiPkg = path.join(workspaceRoot, "apps", "api", "package.json");
      assert.strictEqual(
        await pathExists(apiPkg),
        true,
        "sibling fastify app is still generated after unknown-framework error",
      );

      const errors = messagesAt(logger, "error");
      const errorFired = errors.some(
        (m) => m.includes("legacy") && m.includes("remix"),
      );
      assert.strictEqual(
        errorFired,
        true,
        `expected logger.error to mention "legacy" and "remix" — got: ${JSON.stringify(errors)}`,
      );

      const blockedForLegacy = report.calls.find(
        (c) => c.type === "blocked" && c.target === "legacy",
      );
      assert.ok(
        blockedForLegacy,
        "report recorder must receive a 'blocked' entry for the unknown-framework app",
      );
    });
  });

  it("should skip an app whose name escapes apps/ (path traversal) and continue for siblings", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const report = makeReport();
      // `../escaped` would resolve to `<workspaceRoot>/escaped` (a sibling of
      // apps/) via path.join(root, "apps", "../escaped"); a name with more `..`
      // segments would leave the workspace entirely. The generator must skip it.
      const manifest: Manifest = {
        system: "myorg",
        apps: [
          { name: "../escaped", framework: "next.js" },
          { name: "web", framework: "next.js" },
        ],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config, report);

      assert.strictEqual(
        result.error,
        undefined,
        "an unsafe app name must be skipped, not abort sync",
      );

      // Nothing may be created outside apps/.
      assert.strictEqual(
        await pathExists(path.join(workspaceRoot, "escaped")),
        false,
        "app name with '..' must not create a directory outside apps/",
      );

      // The valid sibling is still generated.
      assert.strictEqual(
        await pathExists(
          path.join(workspaceRoot, "apps", "web", "package.json"),
        ),
        true,
        "sibling app is still generated after the unsafe name is skipped",
      );

      const warns = messagesAt(logger, "warn");
      assert.ok(
        warns.some((m) => m.includes("traversal") && m.includes("../escaped")),
        `expected a path-traversal warning naming the app — got: ${JSON.stringify(warns)}`,
      );
      const blocked = report.calls.find(
        (c) => c.type === "blocked" && c.target === "../escaped",
      );
      assert.ok(
        blocked,
        "report recorder must receive a 'blocked' entry for the unsafe app name",
      );
    });
  });

  it("should skip an entryPoint whose path escapes the app dir, keeping package.json", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const report = makeReport();
      // entryPoint is manifest-overridable; "../../escaped-entry.ts" resolves to
      // <workspaceRoot>/escaped-entry.ts — outside apps/. It must be skipped even
      // though the app name ("web") itself is safe.
      const manifest: Manifest = {
        system: "myorg",
        generator: {
          sync: {
            apps: {
              frameworks: {
                "plain-ts": {
                  packageJson: {
                    template: '{\n  "name": "@{system}/{appName}"\n}\n',
                  },
                  entryPoint: {
                    path: "../../escaped-entry.ts",
                    template: "// escaped\n",
                  },
                },
              },
            },
          },
        },
        apps: [{ name: "web", framework: "plain-ts" }],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config, report);
      assert.strictEqual(
        result.error,
        undefined,
        "an unsafe entryPoint must be skipped, not abort sync",
      );

      assert.strictEqual(
        await pathExists(path.join(workspaceRoot, "escaped-entry.ts")),
        false,
        "entryPoint path with '..' must not write outside apps/",
      );
      assert.strictEqual(
        await pathExists(
          path.join(workspaceRoot, "apps", "web", "package.json"),
        ),
        true,
        "package.json (fixed, safe path) is still written; only the unsafe entry is skipped",
      );

      const warns = messagesAt(logger, "warn");
      assert.ok(
        warns.some(
          (m) => m.includes("entry") && m.includes("escaped-entry.ts"),
        ),
        `expected an unsafe-entryPoint warning — got: ${JSON.stringify(warns)}`,
      );
      const blocked = report.calls.find(
        (c) => c.type === "blocked" && c.target === "web",
      );
      assert.ok(
        blocked,
        "report recorder must receive a 'blocked' entry for the unsafe entryPoint",
      );
    });
  });

  it("should skip an entryPoint with an absolute path (rejected, not nested under the app dir)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const report = makeReport();
      // An absolute entryPoint.path must be rejected outright. `path.join` would
      // silently nest it under appDir (apps/web/tmp/...); `path.resolve` treats it
      // as a root, and the containment check rejects it.
      const manifest: Manifest = {
        system: "myorg",
        generator: {
          sync: {
            apps: {
              frameworks: {
                "plain-ts": {
                  packageJson: {
                    template: '{\n  "name": "@{system}/{appName}"\n}\n',
                  },
                  entryPoint: {
                    path: "/tmp/hexagen-escaped-abs.ts",
                    template: "// escaped\n",
                  },
                },
              },
            },
          },
        },
        apps: [{ name: "web", framework: "plain-ts" }],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config, report);
      assert.strictEqual(result.error, undefined);

      // Not silently nested under the app dir (the path.join behaviour this guards
      // against) — and, being rejected, not written to its absolute target either.
      assert.strictEqual(
        await pathExists(
          path.join(
            workspaceRoot,
            "apps",
            "web",
            "tmp",
            "hexagen-escaped-abs.ts",
          ),
        ),
        false,
        "absolute entryPoint must not be nested under appDir",
      );
      assert.strictEqual(
        await pathExists(
          path.join(workspaceRoot, "apps", "web", "package.json"),
        ),
        true,
        "package.json still written; only the unsafe entry is skipped",
      );
      const warns = messagesAt(logger, "warn");
      assert.ok(
        warns.some((m) => m.includes("escaped-abs.ts")),
        `expected an unsafe-entryPoint warning — got: ${JSON.stringify(warns)}`,
      );
      assert.ok(
        report.calls.find((c) => c.type === "blocked" && c.target === "web"),
        "report recorder must record the absolute entryPoint as blocked",
      );
    });
  });

  it("should apply first-wins dedup for duplicate app names", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const manifest: Manifest = {
        system: "myorg",
        apps: [
          { name: "web", framework: "next.js" },
          { name: "web", framework: "fastify" },
        ],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config);
      assert.strictEqual(result.error, undefined, "dedup must not set error");

      const pkgPath = path.join(workspaceRoot, "apps", "web", "package.json");
      const pkg = await readJson(pkgPath);
      const deps = pkg.dependencies as Record<string, string>;

      assert.ok(
        deps.next,
        "first-wins dedup: Next.js dependencies retained from first occurrence",
      );
      assert.strictEqual(
        "fastify" in deps,
        false,
        "first-wins dedup: Fastify dependencies from duplicate must NOT overwrite",
      );

      const nextEntryExists = await pathExists(
        path.join(workspaceRoot, "apps", "web", "src", "app", "page.tsx"),
      );
      assert.strictEqual(
        nextEntryExists,
        true,
        "first-wins: Next.js entry path was used",
      );

      const warns = messagesAt(logger, "warn");
      const duplicateWarned = warns.some(
        (m) => m.includes("duplicate") && m.includes("web"),
      );
      assert.strictEqual(
        duplicateWarned,
        true,
        `expected logger.warn to flag duplicate "web" — got: ${JSON.stringify(warns)}`,
      );
    });
  });

  it("should use manifest override over built-in templates", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();

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
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

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

      const tsConfig = await readJson(
        path.join(workspaceRoot, "apps", "web", "tsconfig.json"),
      );
      const compilerOptions = tsConfig.compilerOptions as Record<
        string,
        unknown
      >;
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
    });
  });

  it("should preserve existing hand-written app files", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();

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
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config);
      assert.strictEqual(
        result.error,
        undefined,
        "preserving existing files must not set error",
      );

      assert.ok(
        result.skipped.includes(pkgPath),
        `expected pre-existing package.json in skipped list — got: ${JSON.stringify(result.skipped)}`,
      );

      const actual = await readText(pkgPath);
      assert.strictEqual(
        actual,
        handWrittenPkg,
        "hand-written package.json content must be preserved verbatim",
      );

      assert.ok(
        await pathExists(path.join(appDir, "tsconfig.json")),
        "tsconfig.json is still generated when only package.json is hand-written",
      );
      assert.ok(
        await pathExists(path.join(appDir, "src", "app", "page.tsx")),
        "entry point is still generated when only package.json is hand-written",
      );
    });
  });

  it("should substitute depends_on in package.json template placeholder", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();

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
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

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
    });
  });

  it("should interpolate {appName}, {system}, {version}, and {depends_on}", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();

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
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config);
      assert.strictEqual(
        result.error,
        undefined,
        "interpolation must not error",
      );

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

      const warns = messagesAt(logger, "warn");
      const unresolvedWarning = warns.find((m) =>
        m.includes("unresolved template placeholder"),
      );
      assert.strictEqual(
        unresolvedWarning,
        undefined,
        `no unresolved-placeholder warnings expected, got: ${JSON.stringify(warns)}`,
      );
    });
  });

  it("should write tsConfig as structured JSON not template interpolation", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const manifest: Manifest = {
        system: "myorg",
        apps: [{ name: "web", framework: "next.js" }],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: true,
      });

      const result = await generateApps(config);
      assert.strictEqual(result.error, undefined);

      const tsPath = path.join(workspaceRoot, "apps", "web", "tsconfig.json");
      const raw = await readText(tsPath);

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        assert.fail(
          `tsconfig.json must be valid JSON (structured serialization), got parse error: ${message}\nContent:\n${raw}`,
        );
      }

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
    });
  });

  it("should produce no files when apps opt-in flag is not set", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const logger = createSpyLogger();
      const manifest: Manifest = {
        system: "myorg",
        apps: [{ name: "web", framework: "next.js" }],
      };
      const config = makeConfig(workspaceRoot, manifest, {
        logger,
        enableApps: false,
      });

      const result = await generateApps(config);

      assert.strictEqual(result.error, undefined, "no error when disabled");
      assert.strictEqual(
        result.created.length,
        0,
        "no files created when disabled",
      );
      assert.strictEqual(result.updated.length, 0);
      assert.strictEqual(result.skipped.length, 0);
      assert.strictEqual(
        await pathExists(path.join(workspaceRoot, "apps")),
        false,
        "no apps/ directory created when opt-in flag absent",
      );
    });
  });
});
