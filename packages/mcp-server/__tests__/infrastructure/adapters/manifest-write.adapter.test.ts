import { describe, it } from "vitest";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { ManifestWriteAdapter } from "../../../src/infrastructure/adapters/manifest-write.adapter.js";

function minimalContext(name: string) {
  return {
    name,
    type: "core" as const,
    description: "",
    layers: {
      domain: {},
      application: { ports: { in: [], out: [] } },
      infrastructure: { adapters: [] },
    },
  };
}

async function withTempWorkspace<T>(
  initialManifest: Record<string, unknown>,
  fn: (workspaceRoot: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "manifest-write-test-"),
  );
  const manifestPath = path.join(tmpDir, ".architecture", "manifest.yaml");
  await fs.mkdir(path.join(tmpDir, ".architecture"), { recursive: true });
  const content = yaml.dump(initialManifest, {
    indent: 2,
    sortKeys: false,
    lineWidth: 0,
  });
  await fs.writeFile(manifestPath, content, "utf-8");
  try {
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("manifest write adapter", () => {
  it("should return valid when both contexts exist for validateDependency", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [minimalContext("foo"), minimalContext("bar")],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.validateDependency({
          sourceModule: "foo",
          targetModule: "bar",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.valid, true);
    assert.deepStrictEqual(result.value.errors, []);
  });

  it("should return error when source does not exist for validateDependency", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("bar")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.validateDependency({
          sourceModule: "foo",
          targetModule: "bar",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.valid, false);
    assert.ok(result.value.errors.some((e) => e.includes("foo")));
  });

  it("should return error when target does not exist for validateDependency", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("foo")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.validateDependency({
          sourceModule: "foo",
          targetModule: "bar",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.valid, false);
    assert.ok(result.value.errors.some((e) => e.includes("bar")));
  });

  it("should return error when source equals target for validateDependency", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("foo")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.validateDependency({
          sourceModule: "foo",
          targetModule: "foo",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.valid, false);
    assert.ok(result.value.errors.some((e) => e.includes("same")));
  });

  it("should report a direct cycle as invalid for validateDependency", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          { ...minimalContext("foo"), depends_on: ["bar"] },
          minimalContext("bar"),
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.validateDependency({
          sourceModule: "bar",
          targetModule: "foo",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.valid, false);
    assert.ok(result.value.errors.some((e) => e.includes("cycle")));
  });

  it("should add target to source depends_on for addDependency", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [minimalContext("foo"), minimalContext("bar")],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.addDependency({
          sourceModule: "foo",
          targetModule: "bar",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.updated, true);
  });

  it("should return error when source does not exist for addDependency", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [minimalContext("bar")],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.addDependency({
          sourceModule: "foo",
          targetModule: "bar",
        });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("foo"));
  });

  it("should return error when target does not exist for addDependency", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [minimalContext("foo")],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.addDependency({
          sourceModule: "foo",
          targetModule: "bar",
        });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("bar"));
  });

  it("should refuse a self-edge for addDependency", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [minimalContext("foo")],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.addDependency({
          sourceModule: "foo",
          targetModule: "foo",
        });
      },
    );
    // The BFS cycle check cannot catch a fresh self-edge — the explicit
    // source===target refusal must.
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("same"));
  });

  it("should refuse a direct dependency cycle for addDependency", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          { ...minimalContext("foo"), depends_on: ["bar"] },
          minimalContext("bar"),
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.addDependency({
          sourceModule: "bar",
          targetModule: "foo",
        });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("cycle"));
    // The error names the full path that would close the cycle.
    assert.ok((result.error as Error).message.includes("bar → foo → bar"));
  });

  it("should refuse a transitive dependency cycle for addDependency", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          { ...minimalContext("a"), depends_on: ["b"] },
          { ...minimalContext("b"), depends_on: ["c"] },
          minimalContext("c"),
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.addDependency({
          sourceModule: "c",
          targetModule: "a",
        });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("cycle"));
    assert.ok((result.error as Error).message.includes("c → a → b → c"));
  });

  it("should register new context with registerBoundedContext", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("existing")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerBoundedContext({ name: "new-ctx" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.registered, true);
    assert.strictEqual(result.value.alreadyExisted, false);
  });

  it("should return alreadyExisted when context exists for registerBoundedContext", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("foo")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerBoundedContext({ name: "foo" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.registered, false);
    assert.strictEqual(result.value.alreadyExisted, true);
  });

  it("should register inbound port with registerPort", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            type: "core" as const,
            description: "",
            layers: {
              domain: {},
              application: { ports: { in: [], out: [] } },
              infrastructure: { adapters: [] },
            },
          },
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerPort({
          contextName: "billing",
          portName: "PaymentPort",
          direction: "in",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.registered, true);
  });

  it("should return registered=false when port already present for registerPort", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            type: "core" as const,
            description: "",
            layers: {
              domain: {},
              application: { ports: { in: ["PaymentPort"], out: [] } },
              infrastructure: { adapters: [] },
            },
          },
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerPort({
          contextName: "billing",
          portName: "PaymentPort",
          direction: "in",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.registered, false);
  });

  it("should return error when context not found for registerPort", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("billing")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerPort({
          contextName: "nonexistent",
          portName: "PaymentPort",
          direction: "in",
        });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("nonexistent"));
  });

  it("should register adapter with registerAdapter", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            type: "core" as const,
            description: "",
            layers: {
              domain: {},
              application: { ports: { in: ["PaymentPort"], out: [] } },
              infrastructure: { adapters: [] },
            },
          },
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerAdapter({
          contextName: "billing",
          adapterName: "StripeAdapter",
          portName: "PaymentPort",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.registered, true);
  });

  it("should accept registerAdapter against an object-form port declaration", async () => {
    // LegacyOrNewPortSchema allows ports as `{ name: "..." }` objects, not
    // just strings — the referential gate must normalize both forms.
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            type: "core" as const,
            description: "",
            layers: {
              domain: {},
              application: {
                ports: { in: [{ name: "PaymentPort" }], out: [] },
              },
              infrastructure: { adapters: [] },
            },
          },
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerAdapter({
          contextName: "billing",
          adapterName: "StripeAdapter",
          portName: "PaymentPort",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.registered, true);
  });

  it("should refuse registerAdapter against a port the context does not declare", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            type: "core" as const,
            description: "",
            layers: {
              domain: {},
              application: { ports: { in: ["InvoicePort"], out: [] } },
              infrastructure: { adapters: [] },
            },
          },
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerAdapter({
          contextName: "billing",
          adapterName: "StripeAdapter",
          portName: "PaymentPort",
        });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("PaymentPort"));
    assert.ok((result.error as Error).message.includes("InvoicePort"));
  });

  it("should return error when context not found for registerAdapter", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("billing")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerAdapter({
          contextName: "nonexistent",
          adapterName: "StripeAdapter",
          portName: "PaymentPort",
        });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("nonexistent"));
  });

  it("should remove existing port with removePort", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            type: "core" as const,
            description: "",
            layers: {
              domain: {},
              application: { ports: { in: [], out: ["PaymentPort"] } },
              infrastructure: { adapters: [] },
            },
          },
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removePort({
          contextName: "billing",
          portName: "PaymentPort",
          direction: "out",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.removed, true);
  });

  it("should return removed=false when port not found for removePort", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            type: "core" as const,
            description: "",
            layers: {
              domain: {},
              application: { ports: { in: [], out: [] } },
              infrastructure: { adapters: [] },
            },
          },
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removePort({
          contextName: "billing",
          portName: "NonExistent",
          direction: "out",
        });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.removed, false);
  });

  it("should return error when context not found for removePort", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("billing")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removePort({
          contextName: "nonexistent",
          portName: "PaymentPort",
          direction: "out",
        });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("nonexistent"));
  });

  it("should remove existing context with removeContext", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          minimalContext("billing"),
          minimalContext("shipping"),
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removeContext({ contextName: "billing" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.removed, true);
  });

  it("should return removed=false when context not found for removeContext", async () => {
    const result = await withTempWorkspace(
      { bounded_contexts: [minimalContext("billing")] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removeContext({ contextName: "nonexistent" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.removed, false);
  });

  it("should refuse removeContext while other contexts depend on it", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          minimalContext("billing"),
          { ...minimalContext("shipping"), depends_on: ["billing"] },
          { ...minimalContext("reporting"), depends_on: ["billing"] },
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removeContext({ contextName: "billing" });
      },
    );
    assert.strictEqual(result.success, false);
    const message = (result.error as Error).message;
    assert.ok(message.includes("shipping"));
    assert.ok(message.includes("reporting"));
  });

  it("should remove a context once no other context depends on it", async () => {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          minimalContext("billing"),
          { ...minimalContext("shipping"), depends_on: ["notifications"] },
          minimalContext("notifications"),
        ],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removeContext({ contextName: "billing" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.removed, true);
  });

  // Fixture matching IndexManifestSchema: top-level description is required,
  // plane comes from PlaneTypeSchema, and file paths must live under
  // contexts/<plane>/.
  function splitIndexManifest(names: string[]) {
    return {
      version: "2.0",
      description: "split manifest fixture",
      bounded_contexts: names.map((name) => ({
        name,
        type: "core",
        plane: "core",
        status: "active",
        file: `contexts/core/${name}/context.yaml`,
      })),
    };
  }

  async function writeContextFiles(workspaceRoot: string, names: string[]) {
    const coreDir = path.join(
      workspaceRoot,
      ".architecture",
      "contexts",
      "core",
    );
    for (const name of names) {
      await fs.mkdir(path.join(coreDir, name), { recursive: true });
      await fs.writeFile(
        path.join(coreDir, name, "context.yaml"),
        yaml.dump({ name, type: "core", layers: {} }),
        "utf-8",
      );
    }
  }

  it("should refuse writes against a split (v2.0 index) manifest", async () => {
    const result = await withTempWorkspace(
      splitIndexManifest(["billing", "shipping"]),
      async (workspaceRoot) => {
        // Per-context files so readManifestDocument's merge succeeds — the
        // guard must fire on the ON-DISK index shape, not on a read failure.
        await writeContextFiles(workspaceRoot, ["billing", "shipping"]);
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerBoundedContext({ name: "new-ctx" });
      },
    );
    assert.strictEqual(result.success, false);
    assert.ok((result.error as Error).message.includes("split"));
  });

  it("should leave a split manifest's index file untouched after a refused write", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "manifest-write-test-"),
    );
    try {
      const manifestPath = path.join(tmpDir, ".architecture", "manifest.yaml");
      await fs.mkdir(path.join(tmpDir, ".architecture"), { recursive: true });
      const indexContent = yaml.dump(splitIndexManifest(["billing"]));
      await fs.writeFile(manifestPath, indexContent, "utf-8");
      await writeContextFiles(tmpDir, ["billing"]);

      const adapter = new ManifestWriteAdapter(tmpDir);
      const result = await adapter.registerBoundedContext({ name: "new-ctx" });
      assert.strictEqual(result.success, false);
      // Anchor on the guard's message so this test cannot pass via a
      // read-path failure (which would also refuse + leave bytes untouched).
      assert.ok((result.error as Error).message.includes("split"));

      const after = await fs.readFile(manifestPath, "utf-8");
      assert.strictEqual(after, indexContent);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
