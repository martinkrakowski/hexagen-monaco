import { describe, it } from "node:test";
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
              application: { ports: { in: [], out: [] } },
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
});
