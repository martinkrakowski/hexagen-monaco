import { describe, it } from "node:test";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveScope,
  sanitizeScope,
  type Manifest,
} from "../../src/types/manifest.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";
import { generatePackageJson } from "../../src/generators/package-json.js";
import { generateTsconfig } from "../../src/generators/tsconfig.js";
import { generateRootFiles } from "../../src/generators/root-files.js";
import { interpolateWithLog } from "../../src/domain/services/stub-template-resolver.js";
import { DEFAULT_TEMPLATES } from "../../src/domain/stub-templates.js";

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
    forceRoot: true,
    allowDirty: false,
    strict: false,
    mode: "external",
    logger: silentLogger,
    manifest,
    workspaceRoot,
  };
}

// The only @hexagen/* names allowed in a generated project — the published
// tooling devDependencies on the *root* package.json. Mirrors the plan's
// guard-test allowlist (Item 0 route (b) co-releases both).
const TOOLING_ALLOWLIST = [
  "@hexagen-monaco/sync",
  "@hexagen-monaco/arch-linter",
];

// Match the tooling scopes PRECISELY (with the `/` boundary) so a legitimate
// project scope like @hexagenic/* — which contains the substring "@hexagen" —
// is NOT flagged. Covers both the legacy @hexagen/ and the published
// @hexagen-monaco/ scopes.
const TOOLING_SCOPES = ["@hexagen/", "@hexagen-monaco/"];
const refsTooling = (s: string): boolean =>
  TOOLING_SCOPES.some((scope) => s.includes(scope));

describe("sanitizeScope", () => {
  it("strips a leading @ and lowercases", () => {
    assert.strictEqual(sanitizeScope("@My-Scope"), "my-scope");
  });

  it("replaces illegal characters and collapses separators", () => {
    assert.strictEqual(sanitizeScope("My Cool App!!"), "my-cool-app");
    assert.strictEqual(sanitizeScope("a..b__c"), "a-b-c");
  });

  it("trims leading/trailing separators", () => {
    assert.strictEqual(sanitizeScope("--edge--"), "edge");
  });

  it("falls back to generated-project when empty after sanitizing", () => {
    assert.strictEqual(sanitizeScope("@@@"), "generated-project");
    assert.strictEqual(sanitizeScope("   "), "generated-project");
  });

  it("leaves an already-legal scope untouched", () => {
    assert.strictEqual(sanitizeScope("acme"), "acme");
    assert.strictEqual(sanitizeScope("my-app"), "my-app");
  });

  it("does not end with a separator when truncation lands on one", () => {
    // Char 214 (index 213) is "-", char 215 is alphanumeric: slicing to 214
    // would leave a trailing "-" unless the trim runs after the slice.
    const raw = "a".repeat(213) + "-x".repeat(50);
    const out = sanitizeScope(raw);
    assert.ok(out.length <= 214, "must respect the 214-char limit");
    assert.ok(
      !/[._-]$/.test(out),
      "must not end with a separator after truncation",
    );
    assert.strictEqual(out, "a".repeat(213));
  });
});

describe("resolveScope precedence", () => {
  it("uses manifest.scope when present", () => {
    assert.strictEqual(resolveScope({ scope: "acme", system: "sys" }), "acme");
  });

  it("falls back to system when scope is absent", () => {
    assert.strictEqual(resolveScope({ system: "my-sys" }), "my-sys");
  });

  it("falls back to generated-project when neither is set", () => {
    assert.strictEqual(resolveScope({}), "generated-project");
  });

  it("sanitizes whichever source it picks", () => {
    assert.strictEqual(resolveScope({ scope: "@Acme Corp" }), "acme-corp");
  });
});

describe("namespacing guard (generated project uses @{scope}, not @hexagen)", () => {
  it("emits @{scope}/ package names + paths and no @hexagen/ outside the tooling devDeps", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-namespacing-test-"),
    );
    try {
      const manifest: Manifest = {
        system: "my-app",
        scope: "acme",
        bounded_contexts: [
          { name: "shared", type: "shared-kernel" },
          { name: "core", depends_on: ["shared"] },
        ],
      };
      const config = makeConfig(workspaceRoot, manifest);

      for (const mod of ["shared", "core"]) {
        const modPath = path.join(workspaceRoot, "packages", mod);
        await fs.mkdir(modPath, { recursive: true });
        await generatePackageJson(modPath, mod, config);
        await generateTsconfig(modPath, mod, config);
      }
      await generateRootFiles(config);

      // (2) positive: the project's own packages carry the @acme scope.
      const corePkg = JSON.parse(
        await fs.readFile(
          path.join(workspaceRoot, "packages", "core", "package.json"),
          "utf8",
        ),
      ) as { name: string; dependencies?: Record<string, string> };
      assert.strictEqual(corePkg.name, "@acme/core");
      assert.ok(
        corePkg.dependencies?.["@acme/shared"] === "workspace:*",
        "core must depend on @acme/shared (not @hexagen/shared)",
      );
      const tsconfigBase = await fs.readFile(
        path.join(workspaceRoot, "tsconfig.base.json"),
        "utf8",
      );
      assert.ok(
        tsconfigBase.includes('"@acme/*"'),
        "tsconfig.base paths must use @acme/*",
      );
      assert.ok(
        !refsTooling(tsconfigBase),
        "tsconfig.base must not retain the tooling namespace",
      );

      // (1) two-sided: walk every emitted file. A tooling scope (@hexagen-monaco/,
      // and never the legacy @hexagen/) may appear ONLY as an allowlisted devDep
      // on the root package.json. `refsTooling` matches on the `/` boundary so a
      // project scope like @hexagenic/ is not a false positive.
      const files = await walk(workspaceRoot);
      for (const file of files) {
        const content = await fs.readFile(file, "utf8");
        if (file === path.join(workspaceRoot, "package.json")) {
          const pkg = JSON.parse(content) as {
            devDependencies?: Record<string, string>;
            [k: string]: unknown;
          };
          const toolingDevDeps = Object.keys(pkg.devDependencies ?? {}).filter(
            (k) => refsTooling(k),
          );
          for (const dep of toolingDevDeps) {
            assert.ok(
              TOOLING_ALLOWLIST.includes(dep),
              `unexpected tooling devDep: ${dep}`,
            );
          }
          // A tooling scope must appear ONLY inside devDependencies.
          const rest = { ...pkg };
          delete rest.devDependencies;
          assert.ok(
            !refsTooling(JSON.stringify(rest)),
            "root package.json must not reference a tooling scope outside devDependencies",
          );
        } else {
          assert.ok(
            !refsTooling(content),
            `emitted project file leaked a tooling scope: ${path.relative(workspaceRoot, file)}`,
          );
        }
      }
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("emitted code templates reference @{scope}/shared, not @hexagen", () => {
  it("the use-case stub template interpolates {scope} from the manifest", () => {
    const config = makeConfig("/tmp/unused", { scope: "acme" });
    const out = interpolateWithLog(
      DEFAULT_TEMPLATES.useCase,
      "Foo",
      "useCase",
      config,
    );
    assert.ok(
      out.includes("from '@acme/shared'"),
      "use-case stub must import Result from @acme/shared",
    );
    assert.ok(
      !out.includes("@hexagen/"),
      "use-case stub must not leak the @hexagen namespace",
    );
  });
});

describe("tooling-scope matcher (guard precision)", () => {
  it("matches the tooling scopes but not lookalike project scopes", () => {
    assert.equal(refsTooling("@hexagen-monaco/sync"), true);
    assert.equal(refsTooling("@hexagen/shared"), true);
    // The whole point: @hexagenic contains the "@hexagen" substring but is a
    // legitimate, distinct project scope — must NOT be flagged.
    assert.equal(refsTooling("@hexagenic/core"), false);
    assert.equal(refsTooling("@acme/core"), false);
  });
});

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
