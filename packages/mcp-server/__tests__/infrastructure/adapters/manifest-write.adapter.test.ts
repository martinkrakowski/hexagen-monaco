import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ManifestWriteAdapter } from "../../../src/infrastructure/adapters/manifest-write.adapter.js";

async function withTempWorkspace<T>(
  initialManifest: Record<string, unknown>,
  fn: (workspaceRoot: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "manifest-write-test-"),
  );
  const manifestPath = path.join(tmpDir, ".architecture", "manifest.yaml");
  await fs.mkdir(path.join(tmpDir, ".architecture"), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(initialManifest), "utf-8");
  try {
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

(async () => {
  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [{ name: "foo" }, { name: "bar" }],
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
  }
  console.log(
    "  ✅ validateDependency: returns valid when both contexts exist",
  );

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "bar" }] },
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
  }
  console.log(
    "  ✅ validateDependency: returns error when source does not exist",
  );

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "foo" }] },
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
  }
  console.log(
    "  ✅ validateDependency: returns error when target does not exist",
  );

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "foo" }] },
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
  }
  console.log(
    "  ✅ validateDependency: returns error when source equals target",
  );

  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [{ name: "foo" }, { name: "bar" }],
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
  }
  console.log("  ✅ addDependency: adds target to source depends_on");

  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [{ name: "bar" }],
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
  }
  console.log("  ✅ addDependency: returns error when source does not exist");

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "existing" }] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerBoundedContext({ name: "new-ctx" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.registered, true);
    assert.strictEqual(result.value.alreadyExisted, false);
  }
  console.log("  ✅ registerBoundedContext: registers new context");

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "foo" }] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.registerBoundedContext({ name: "foo" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.registered, false);
    assert.strictEqual(result.value.alreadyExisted, true);
  }
  console.log(
    "  ✅ registerBoundedContext: returns alreadyExisted when context exists",
  );

  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            layers: {
              application: { ports: { in: [], out: [] } },
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
  }
  console.log("  ✅ registerPort: registers inbound port");

  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            layers: {
              application: { ports: { in: ["PaymentPort"], out: [] } },
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
  }
  console.log(
    "  ✅ registerPort: returns registered=false when already present",
  );

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "billing" }] },
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
  }
  console.log("  ✅ registerPort: returns error when context not found");

  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            layers: {
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
  }
  console.log("  ✅ registerAdapter: registers adapter");

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "billing" }] },
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
  }
  console.log("  ✅ registerAdapter: returns error when context not found");

  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            layers: {
              application: { ports: { in: [], out: ["PaymentPort"] } },
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
  }
  console.log("  ✅ removePort: removes existing port");

  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [
          {
            name: "billing",
            layers: {
              application: { ports: { in: [], out: [] } },
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
  }
  console.log("  ✅ removePort: returns removed=false when port not found");

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "billing" }] },
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
  }
  console.log("  ✅ removePort: returns error when context not found");

  {
    const result = await withTempWorkspace(
      {
        bounded_contexts: [{ name: "billing" }, { name: "shipping" }],
      },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removeContext({ contextName: "billing" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.removed, true);
  }
  console.log("  ✅ removeContext: removes existing context");

  {
    const result = await withTempWorkspace(
      { bounded_contexts: [{ name: "billing" }] },
      async (workspaceRoot) => {
        const adapter = new ManifestWriteAdapter(workspaceRoot);
        return adapter.removeContext({ contextName: "nonexistent" });
      },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.removed, false);
  }
  console.log(
    "  ✅ removeContext: returns removed=false when context not found",
  );

  console.log("✅ manifest-write.adapter tests passed");
})();
