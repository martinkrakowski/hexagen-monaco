import { describe, it } from "node:test";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateTsconfig } from "../../src/generators/tsconfig.js";
import type {
  BoundedContext,
  Manifest,
  TsConfigTemplate,
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
    tsconfigPath: string;
  }) => Promise<void>,
) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-tsconfig-test-"),
  );
  const modulePath = path.join(workspaceRoot, "packages", moduleName);
  await fs.mkdir(modulePath, { recursive: true });
  const tsconfigPath = path.join(modulePath, "tsconfig.json");
  try {
    await fn({ workspaceRoot, modulePath, tsconfigPath });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function readTsconfig(
  filePath: string,
): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

const WORKSPACE_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: true,
    composite: true,
    tsBuildInfoFile: "./dist/tsconfig.tsbuildinfo",
    paths: {},
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist", ".turbo"],
  references: [],
};

describe("tsconfig", () => {
  it("should fall back to built-in template when manifest has no workspaceDefaults.tsConfig", async () => {
    await withTempWorkspace(
      "no-defaults",
      async ({ workspaceRoot, tsconfigPath }) => {
        const manifest: Manifest = {
          bounded_contexts: [{ name: "no-defaults" }],
        };
        const config = makeConfig(workspaceRoot, manifest);

        const result = await generateTsconfig(
          path.dirname(tsconfigPath),
          "no-defaults",
          config,
        );
        assert.strictEqual(
          result.created.length,
          1,
          "generator should create tsconfig.json using built-in fallback",
        );

        const cfg = await readTsconfig(tsconfigPath);
        assert.strictEqual(cfg.extends, "../../tsconfig.base.json");
        const co = cfg.compilerOptions as Record<string, unknown>;
        assert.strictEqual(co.rootDir, "src");
        assert.strictEqual(co.outDir, "dist");
        assert.strictEqual(co.emitDeclarationOnly, true);
        assert.deepStrictEqual(co.paths, {});
      },
    );
  });

  it("should use workspaceDefaults.tsConfig as base when present", async () => {
    await withTempWorkspace(
      "with-defaults",
      async ({ workspaceRoot, tsconfigPath }) => {
        const manifest: Manifest = {
          workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
          bounded_contexts: [{ name: "with-defaults" }],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generateTsconfig(
          path.dirname(tsconfigPath),
          "with-defaults",
          config,
        );
        const cfg = await readTsconfig(tsconfigPath);
        const co = cfg.compilerOptions as Record<string, unknown>;
        assert.strictEqual(
          co.declarationMap,
          true,
          "should pick up declarationMap from defaults",
        );
        assert.strictEqual(co.tsBuildInfoFile, "./dist/tsconfig.tsbuildinfo");
        assert.deepStrictEqual(cfg.include, ["src/**/*"]);
        assert.deepStrictEqual(cfg.exclude, ["node_modules", "dist", ".turbo"]);
      },
    );
  });

  it("should deep-merge per-context generator.tsConfig over workspace defaults", async () => {
    await withTempWorkspace(
      "merged-ctx",
      async ({ workspaceRoot, tsconfigPath }) => {
        const context: BoundedContext = {
          name: "merged-ctx",
          generator: {
            tsConfig: {
              compilerOptions: {
                emitDeclarationOnly: false,
                jsx: "react-jsx",
              },
            },
          },
        };
        const manifest: Manifest = {
          workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
          bounded_contexts: [context],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generateTsconfig(
          path.dirname(tsconfigPath),
          "merged-ctx",
          config,
        );
        const cfg = await readTsconfig(tsconfigPath);
        const co = cfg.compilerOptions as Record<string, unknown>;
        assert.strictEqual(co.emitDeclarationOnly, false);
        assert.strictEqual(co.jsx, "react-jsx");
        assert.strictEqual(co.rootDir, "src");
        assert.strictEqual(co.declarationMap, true);
        assert.strictEqual(co.composite, true);
      },
    );
  });

  it("should emit references derived from depends_on", async () => {
    await withTempWorkspace(
      "dep-ctx",
      async ({ workspaceRoot, tsconfigPath }) => {
        const manifest: Manifest = {
          workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
          bounded_contexts: [
            { name: "dep-ctx", depends_on: ["shared", "messaging"] },
          ],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generateTsconfig(path.dirname(tsconfigPath), "dep-ctx", config);
        const cfg = await readTsconfig(tsconfigPath);
        assert.deepStrictEqual(
          cfg.references,
          [{ path: "../shared" }, { path: "../messaging" }],
          "references should be derived from depends_on in declaration order",
        );
      },
    );
  });

  it("should merge depends_on-derived references with override refs and dedupe", async () => {
    await withTempWorkspace(
      "merge-refs",
      async ({ workspaceRoot, tsconfigPath }) => {
        const context: BoundedContext = {
          name: "merge-refs",
          depends_on: ["shared"],
          generator: {
            tsConfig: {
              references: [{ path: "../shared" }, { path: "../extra-ref" }],
            },
          },
        };
        const manifest: Manifest = {
          workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
          bounded_contexts: [context],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generateTsconfig(
          path.dirname(tsconfigPath),
          "merge-refs",
          config,
        );
        const cfg = await readTsconfig(tsconfigPath);
        assert.deepStrictEqual(
          cfg.references,
          [{ path: "../shared" }, { path: "../extra-ref" }],
          "override refs come first; depends_on refs append; duplicates removed by path",
        );
      },
    );
  });

  it("should always enforce paths: {} in compilerOptions", async () => {
    await withTempWorkspace(
      "paths-enforced",
      async ({ workspaceRoot, tsconfigPath }) => {
        const manifest: Manifest = {
          workspaceDefaults: {
            tsConfig: {
              extends: "../../tsconfig.base.json",
              compilerOptions: {
                rootDir: "src",
                outDir: "dist",
                composite: true,
              },
              include: ["src/**/*"],
            },
          },
          bounded_contexts: [{ name: "paths-enforced" }],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generateTsconfig(
          path.dirname(tsconfigPath),
          "paths-enforced",
          config,
        );
        const cfg = await readTsconfig(tsconfigPath);
        const co = cfg.compilerOptions as Record<string, unknown>;
        assert.deepStrictEqual(
          co.paths,
          {},
          "composite-safety invariant: paths must always be emitted as {}",
        );
      },
    );
  });

  it("should produce output for sync, shared, and ui via per-context overrides", async () => {
    for (const name of ["sync", "shared", "ui"] as const) {
      await withTempWorkspace(name, async ({ workspaceRoot, tsconfigPath }) => {
        const manifest: Manifest = {
          workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
          bounded_contexts: [
            {
              name,
              generator: {
                tsConfig:
                  name === "ui"
                    ? { compilerOptions: { jsx: "react-jsx" } }
                    : { compilerOptions: { emitDeclarationOnly: false } },
              },
            },
          ],
        };
        const config = makeConfig(workspaceRoot, manifest);
        const result = await generateTsconfig(
          path.dirname(tsconfigPath),
          name,
          config,
        );
        assert.strictEqual(
          result.created.length,
          1,
          `${name}: generator must produce tsconfig.json output (skip list removed)`,
        );
        assert.strictEqual(
          result.skipped.length,
          0,
          `${name}: generator must NOT skip output`,
        );
        const cfg = await readTsconfig(tsconfigPath);
        const co = cfg.compilerOptions as Record<string, unknown>;
        if (name === "ui") {
          assert.strictEqual(co.jsx, "react-jsx", "ui override must apply");
        } else {
          assert.strictEqual(
            co.emitDeclarationOnly,
            false,
            `${name} override must apply`,
          );
        }
      });
    }
  });

  it("should fully replace base include with override include array", async () => {
    await withTempWorkspace(
      "custom-include",
      async ({ workspaceRoot, tsconfigPath }) => {
        const context: BoundedContext = {
          name: "custom-include",
          generator: {
            tsConfig: {
              include: ["src/**/*", "types/**/*.d.ts"],
            },
          },
        };
        const manifest: Manifest = {
          workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
          bounded_contexts: [context],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generateTsconfig(
          path.dirname(tsconfigPath),
          "custom-include",
          config,
        );
        const cfg = await readTsconfig(tsconfigPath);
        assert.deepStrictEqual(
          cfg.include,
          ["src/**/*", "types/**/*.d.ts"],
          "override include fully replaces base include",
        );
      },
    );
  });

  it("should produce workspace defaults + paths:{} + depends_on refs with no overrides", async () => {
    await withTempWorkspace(
      "plain-ctx",
      async ({ workspaceRoot, tsconfigPath }) => {
        const manifest: Manifest = {
          workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
          bounded_contexts: [{ name: "plain-ctx", depends_on: ["shared"] }],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generateTsconfig(path.dirname(tsconfigPath), "plain-ctx", config);
        const cfg = await readTsconfig(tsconfigPath);

        assert.strictEqual(cfg.extends, "../../tsconfig.base.json");
        const co = cfg.compilerOptions as Record<string, unknown>;
        assert.strictEqual(co.rootDir, "src");
        assert.strictEqual(co.outDir, "dist");
        assert.strictEqual(co.declaration, true);
        assert.strictEqual(co.emitDeclarationOnly, true);
        assert.strictEqual(co.declarationMap, true);
        assert.strictEqual(co.composite, true);
        assert.strictEqual(co.tsBuildInfoFile, "./dist/tsconfig.tsbuildinfo");
        assert.deepStrictEqual(co.paths, {});
        assert.deepStrictEqual(cfg.include, ["src/**/*"]);
        assert.deepStrictEqual(cfg.exclude, ["node_modules", "dist", ".turbo"]);
        assert.deepStrictEqual(cfg.references, [{ path: "../shared" }]);
      },
    );
  });

  it("should produce byte-identical output on idempotent re-run", async () => {
    await withTempWorkspace(
      "idempotent",
      async ({ workspaceRoot, tsconfigPath }) => {
        const manifest: Manifest = {
          workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
          bounded_contexts: [{ name: "idempotent", depends_on: ["shared"] }],
        };
        const config = makeConfig(workspaceRoot, manifest);

        await generateTsconfig(
          path.dirname(tsconfigPath),
          "idempotent",
          config,
        );
        const first = await fs.readFile(tsconfigPath, "utf8");

        const second = await generateTsconfig(
          path.dirname(tsconfigPath),
          "idempotent",
          config,
        );
        const after = await fs.readFile(tsconfigPath, "utf8");
        assert.strictEqual(
          first,
          after,
          "file contents must be byte-identical",
        );
        assert.strictEqual(
          second.created.length,
          0,
          "second run must not re-create the file",
        );
      },
    );
  });
});
