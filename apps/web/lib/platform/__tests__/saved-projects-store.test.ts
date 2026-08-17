import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { SavedProject } from "@hexagen/shared";
import { createPlatformStore } from "../store";

function project(id: string, name = id): SavedProject {
  return {
    id,
    name,
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: { workspaceName: name },
    manifestYaml: "system: shop\nbounded_contexts: []\n",
  };
}

describe("sqlite SavedProjectsPersistencePort", () => {
  it("creates, loads newest-first, updates, and deletes by the port contract", async () => {
    const store = createPlatformStore(":memory:");
    const a = project("11111111-1111-4111-8111-111111111111", "alpha");
    const b = project("22222222-2222-4222-8222-222222222222", "beta");

    const createdA = await store.projects.createProjectRecord(a);
    const createdB = await store.projects.createProjectRecord(b);
    assert.equal(createdA.success, true);
    assert.equal(createdB.success, true);

    const loaded = await store.projects.loadProjects();
    assert.equal(loaded.success, true);
    if (!loaded.success) return;
    assert.deepEqual(
      loaded.value.map((p) => p.id),
      [b.id, a.id],
    );

    const duplicate = await store.projects.createProjectRecord(a);
    assert.equal(duplicate.success, false);
    if (!duplicate.success) assert.equal(duplicate.error.kind, "Conflict");

    const updated = await store.projects.updateProjectRecord(
      a.id,
      (current) => ({
        ...current,
        name: "alpha-renamed",
        updatedAt: 9,
      }),
    );
    assert.equal(updated.success, true);
    if (updated.success) assert.equal(updated.value.name, "alpha-renamed");

    const missing = await store.projects.updateProjectRecord(
      "33333333-3333-4333-8333-333333333333",
      (p) => p,
    );
    assert.equal(missing.success, false);
    if (!missing.success) assert.equal(missing.error.kind, "NotFound");

    const deleted = await store.projects.deleteProjectRecord(a.id);
    assert.equal(deleted.success, true);
    const again = await store.projects.deleteProjectRecord(a.id);
    assert.equal(again.success, true);

    const after = await store.projects.loadProjects();
    assert.equal(after.success, true);
    if (after.success) {
      assert.deepEqual(
        after.value.map((p) => p.id),
        [b.id],
      );
    }
    store.close();
  });

  it("saveProjects replaces the whole list in the given order", async () => {
    const store = createPlatformStore(":memory:");
    const a = project("11111111-1111-4111-8111-111111111111", "a");
    const b = project("22222222-2222-4222-8222-222222222222", "b");
    await store.projects.createProjectRecord(a);
    const written = await store.projects.saveProjects([a, b]);
    assert.equal(written.success, true);
    const loaded = await store.projects.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) {
      assert.deepEqual(
        loaded.value.map((p) => p.name),
        ["a", "b"],
      );
    }
    store.close();
  });
});
