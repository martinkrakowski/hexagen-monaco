import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isIndexManifest,
  mergeSplitManifest,
} from "../../../src/infrastructure/adapters/manifest-merge-loader.js";

describe("isIndexManifest", () => {
  it("returns true for valid index manifest with version 2.0 and bounded_contexts with .file", () => {
    const parsed = {
      version: "2.0",
      system: "test-system",
      bounded_contexts: [
        {
          name: "my-context",
          type: "core",
          file: "contexts/core/my-context/context.yaml",
        },
      ],
    };
    assert.strictEqual(isIndexManifest(parsed), true);
  });

  it("returns false for monolithic manifest with bounded_contexts containing .layers", () => {
    const parsed = {
      bounded_contexts: [
        {
          name: "my-context",
          type: "core",
          description: "Test",
          layers: { domain: { entities: ["TestEntity"] } },
        },
      ],
    };
    assert.strictEqual(isIndexManifest(parsed), false);
  });

  it("returns false for null input", () => {
    assert.strictEqual(isIndexManifest(null), false);
  });

  it("returns false for non-object input", () => {
    assert.strictEqual(isIndexManifest("string"), false);
    assert.strictEqual(isIndexManifest(42), false);
    assert.strictEqual(isIndexManifest(true), false);
  });

  it("returns false when version is not 2.0", () => {
    const parsed = {
      version: "1.0",
      bounded_contexts: [
        {
          name: "my-context",
          type: "core",
          file: "contexts/core/my-context/context.yaml",
        },
      ],
    };
    assert.strictEqual(isIndexManifest(parsed), false);
  });

  it("returns false when bounded_contexts is missing", () => {
    const parsed = { version: "2.0" };
    assert.strictEqual(isIndexManifest(parsed), false);
  });

  it("returns false when bounded_contexts entries have no .file property", () => {
    const parsed = {
      version: "2.0",
      bounded_contexts: [{ name: "my-context", type: "core" }],
    };
    assert.strictEqual(isIndexManifest(parsed), false);
  });
});

describe("mergeSplitManifest", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setupDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "mml-test-"));
    tmpDir = dir;
    return dir;
  }

  it("loads a monolithic manifest.yaml as passthrough", async () => {
    const dir = await setupDir();
    const archDir = join(dir, ".architecture");
    await mkdir(archDir, { recursive: true });

    const monolithicYaml = [
      `system: test-system`,
      `scope: test-scope`,
      `bounded_contexts:`,
      `  - name: my-context`,
      `    type: core`,
      `    description: A test context`,
      `    layers:`,
      `      domain:`,
      `        entities:`,
      `          - TestEntity`,
    ].join("\n");

    const manifestPath = join(archDir, "manifest.yaml");
    await writeFile(manifestPath, monolithicYaml, "utf-8");

    const result = await mergeSplitManifest(dir, manifestPath);

    assert.strictEqual(result.system, "test-system");
    assert.strictEqual(result.scope, "test-scope");
    assert.ok(Array.isArray(result.bounded_contexts));
    assert.strictEqual(result.bounded_contexts!.length, 1);
    assert.strictEqual(result.bounded_contexts![0].name, "my-context");
  });

  it("merges index manifest with context files", async () => {
    const dir = await setupDir();
    const archDir = join(dir, ".architecture");
    const contextsDir = join(archDir, "contexts", "core", "ctx-a");
    const contextsDir2 = join(archDir, "contexts", "supporting", "ctx-b");
    await mkdir(contextsDir, { recursive: true });
    await mkdir(contextsDir2, { recursive: true });

    const indexYaml = [
      `version: '2.0'`,
      `system: merge-system`,
      `scope: merge-scope`,
      `bounded_contexts:`,
      `  - name: ctx-a`,
      `    type: core`,
      `    plane: core`,
      `    status: active`,
      `    file: contexts/core/ctx-a/context.yaml`,
      `  - name: ctx-b`,
      `    type: supporting`,
      `    plane: supporting`,
      `    status: active`,
      `    file: contexts/supporting/ctx-b/context.yaml`,
    ].join("\n");

    const contextA = [
      `name: ctx-a`,
      `type: core`,
      `description: Context A`,
      `layers:`,
      `  domain:`,
      `    entities:`,
      `      - EntityA`,
      `  application:`,
      `    use_cases:`,
      `      - DoA`,
      `depends_on:`,
      `  - shared`,
    ].join("\n");

    const contextB = [
      `name: ctx-b`,
      `type: supporting`,
      `description: Context B`,
      `layers:`,
      `  infrastructure:`,
      `    adapters:`,
      `      - AdapterB`,
    ].join("\n");

    await writeFile(join(archDir, "manifest.yaml"), indexYaml, "utf-8");
    await writeFile(join(contextsDir, "context.yaml"), contextA, "utf-8");
    await writeFile(join(contextsDir2, "context.yaml"), contextB, "utf-8");

    const result = await mergeSplitManifest(
      dir,
      join(archDir, "manifest.yaml"),
    );

    assert.strictEqual(result.system, "merge-system");
    assert.strictEqual(result.scope, "merge-scope");
    assert.strictEqual(result.bounded_contexts!.length, 2);

    const ctxA = result.bounded_contexts!.find((c) => c.name === "ctx-a");
    const ctxB = result.bounded_contexts!.find((c) => c.name === "ctx-b");

    assert.ok(ctxA);
    assert.strictEqual(ctxA.type, "core");
    assert.strictEqual(ctxA.plane, "core");
    assert.strictEqual(ctxA.status, "active");
    assert.deepStrictEqual(ctxA.depends_on, ["shared"]);

    assert.ok(ctxB);
    assert.strictEqual(ctxB.type, "supporting");
    assert.strictEqual(ctxB.plane, "supporting");
  });

  it("throws when index manifest references a missing context file", async () => {
    const dir = await setupDir();
    const archDir = join(dir, ".architecture");
    await mkdir(archDir, { recursive: true });

    const indexYaml = [
      `version: '2.0'`,
      `system: test-system`,
      `bounded_contexts:`,
      `  - name: missing`,
      `    type: core`,
      `    file: contexts/core/missing/context.yaml`,
    ].join("\n");

    await writeFile(join(archDir, "manifest.yaml"), indexYaml, "utf-8");

    await assert.rejects(
      () => mergeSplitManifest(dir, join(archDir, "manifest.yaml")),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Context file not found/);
        return true;
      },
    );
  });

  it("throws with context name when context file fails BoundedContextSchema validation", async () => {
    const dir = await setupDir();
    const archDir = join(dir, ".architecture");
    const ctxDir = join(archDir, "contexts", "core", "bad-ctx");
    await mkdir(ctxDir, { recursive: true });

    const indexYaml = [
      `version: '2.0'`,
      `system: test-system`,
      `bounded_contexts:`,
      `  - name: bad-ctx`,
      `    type: core`,
      `    file: contexts/core/bad-ctx/context.yaml`,
    ].join("\n");

    const badContext = [
      `name: bad-ctx`,
      `type: INVALID_TYPE`,
      `description: missing required fields`,
    ].join("\n");

    await writeFile(join(archDir, "manifest.yaml"), indexYaml, "utf-8");
    await writeFile(join(ctxDir, "context.yaml"), badContext, "utf-8");

    await assert.rejects(
      () => mergeSplitManifest(dir, join(archDir, "manifest.yaml")),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /bad-ctx/);
        return true;
      },
    );
  });

  it("merges app entries loaded from separate files", async () => {
    const dir = await setupDir();
    const archDir = join(dir, ".architecture");
    const appsDir = join(archDir, "apps");
    const ctxDir = join(archDir, "contexts", "core", "my-context");
    await mkdir(appsDir, { recursive: true });
    await mkdir(ctxDir, { recursive: true });

    const indexYaml = [
      `version: '2.0'`,
      `system: app-system`,
      `bounded_contexts:`,
      `  - name: my-context`,
      `    type: core`,
      `    file: contexts/core/my-context/context.yaml`,
      `apps:`,
      `  - name: web`,
      `    file: apps/web.app.yaml`,
    ].join("\n");

    const contextYaml = [
      `name: my-context`,
      `type: core`,
      `description: Test context`,
      `layers:`,
      `  domain:`,
      `    entities:`,
      `      - TestEntity`,
    ].join("\n");

    const appYaml = [`name: web`, `framework: next.js`].join("\n");

    await writeFile(join(archDir, "manifest.yaml"), indexYaml, "utf-8");
    await writeFile(join(ctxDir, "context.yaml"), contextYaml, "utf-8");
    await writeFile(join(appsDir, "web.app.yaml"), appYaml, "utf-8");

    const result = await mergeSplitManifest(
      dir,
      join(archDir, "manifest.yaml"),
    );

    assert.ok(Array.isArray(result.apps));
    assert.strictEqual(result.apps!.length, 1);
    assert.strictEqual(
      (result.apps![0] as Record<string, unknown>).name,
      "web",
    );
    assert.strictEqual(
      (result.apps![0] as Record<string, unknown>).framework,
      "next.js",
    );
  });

  it("throws on path traversal in context file reference", async () => {
    const dir = await setupDir();
    const archDir = join(dir, ".architecture");
    await mkdir(archDir, { recursive: true });

    const indexYaml = [
      `version: '2.0'`,
      `system: traversal-test`,
      `bounded_contexts:`,
      `  - name: evil`,
      `    type: core`,
      `    file: ../../etc/passwd`,
    ].join("\n");

    await writeFile(join(archDir, "manifest.yaml"), indexYaml, "utf-8");

    await assert.rejects(
      () => mergeSplitManifest(dir, join(archDir, "manifest.yaml")),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Path traversal detected/);
        return true;
      },
    );
  });

  it("throws on path traversal in app file reference", async () => {
    const dir = await setupDir();
    const archDir = join(dir, ".architecture");
    const ctxDir = join(archDir, "contexts", "core", "my-context");
    await mkdir(ctxDir, { recursive: true });

    const indexYaml = [
      `version: '2.0'`,
      `system: traversal-test`,
      `bounded_contexts:`,
      `  - name: my-context`,
      `    type: core`,
      `    file: contexts/core/my-context/context.yaml`,
      `apps:`,
      `  - name: evil-app`,
      `    file: ../../../etc/shadow`,
    ].join("\n");

    const contextYaml = [
      `name: my-context`,
      `type: core`,
      `description: Test context`,
      `layers:`,
      `  domain:`,
      `    entities:`,
      `      - TestEntity`,
    ].join("\n");

    await writeFile(join(archDir, "manifest.yaml"), indexYaml, "utf-8");
    await writeFile(join(ctxDir, "context.yaml"), contextYaml, "utf-8");

    await assert.rejects(
      () => mergeSplitManifest(dir, join(archDir, "manifest.yaml")),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Path traversal detected/);
        return true;
      },
    );
  });

  it("throws on invalid app YAML that fails AppSchema validation", async () => {
    const dir = await setupDir();
    const archDir = join(dir, ".architecture");
    const appsDir = join(archDir, "apps");
    const ctxDir = join(archDir, "contexts", "core", "my-context");
    await mkdir(appsDir, { recursive: true });
    await mkdir(ctxDir, { recursive: true });

    const indexYaml = [
      `version: '2.0'`,
      `system: bad-app-test`,
      `bounded_contexts:`,
      `  - name: my-context`,
      `    type: core`,
      `    file: contexts/core/my-context/context.yaml`,
      `apps:`,
      `  - name: bad-app`,
      `    file: apps/bad.app.yaml`,
    ].join("\n");

    const contextYaml = [
      `name: my-context`,
      `type: core`,
      `description: Test context`,
      `layers:`,
      `  domain:`,
      `    entities:`,
      `      - TestEntity`,
    ].join("\n");

    const badAppYaml = `driver: not-a-valid-driver`;

    await writeFile(join(archDir, "manifest.yaml"), indexYaml, "utf-8");
    await writeFile(join(ctxDir, "context.yaml"), contextYaml, "utf-8");
    await writeFile(join(appsDir, "bad.app.yaml"), badAppYaml, "utf-8");

    await assert.rejects(
      () => mergeSplitManifest(dir, join(archDir, "manifest.yaml")),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /App file.*validation failed/);
        return true;
      },
    );
  });
});
