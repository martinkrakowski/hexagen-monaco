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

    const projects = store.projectsFor("owner-a");
    const createdA = await projects.createProjectRecord(a);
    const createdB = await projects.createProjectRecord(b);
    assert.equal(createdA.success, true);
    assert.equal(createdB.success, true);

    const loaded = await projects.loadProjects();
    assert.equal(loaded.success, true);
    if (!loaded.success) return;
    assert.deepEqual(
      loaded.value.map((p) => p.id),
      [b.id, a.id],
    );

    const duplicate = await projects.createProjectRecord(a);
    assert.equal(duplicate.success, false);
    if (!duplicate.success) assert.equal(duplicate.error.kind, "Conflict");

    const updated = await projects.updateProjectRecord(a.id, (current) => ({
      ...current,
      name: "alpha-renamed",
      updatedAt: 9,
    }));
    assert.equal(updated.success, true);
    if (updated.success) assert.equal(updated.value.name, "alpha-renamed");

    const missing = await projects.updateProjectRecord(
      "33333333-3333-4333-8333-333333333333",
      (p) => p,
    );
    assert.equal(missing.success, false);
    if (!missing.success) assert.equal(missing.error.kind, "NotFound");

    const deleted = await projects.deleteProjectRecord(a.id);
    assert.equal(deleted.success, true);
    const again = await projects.deleteProjectRecord(a.id);
    assert.equal(again.success, true);

    const after = await projects.loadProjects();
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
    const projects = store.projectsFor("owner-a");
    await projects.createProjectRecord(a);
    const written = await projects.saveProjects([a, b]);
    assert.equal(written.success, true);
    const loaded = await projects.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) {
      assert.deepEqual(
        loaded.value.map((p) => p.name),
        ["a", "b"],
      );
    }
    store.close();
  });

  it("does not leak one owner's projects to another", async () => {
    const store = createPlatformStore(":memory:");
    const a = project("11111111-1111-4111-8111-111111111111", "alpha");
    await store.projectsFor("owner-a").createProjectRecord(a);
    const other = await store.projectsFor("owner-b").loadProjects();
    assert.equal(other.success, true);
    if (other.success) assert.deepEqual(other.value, []);
    store.close();
  });

  it("putProject rejects a stale If-Match without clobbering the stored row", async () => {
    const store = createPlatformStore(":memory:");
    const a = project("11111111-1111-4111-8111-111111111111", "alpha");
    const projects = store.projectsFor("owner-a");
    await projects.createProjectRecord(a);
    const first = projects.putProject({ ...a, name: "first", updatedAt: 2 }, 1);
    assert.equal(first.success, true);
    const stale = projects.putProject({ ...a, name: "stale", updatedAt: 3 }, 1);
    assert.equal(stale.success, false);
    if (!stale.success) assert.equal(stale.error.kind, "Conflict");
    const loaded = await projects.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.equal(loaded.value[0]?.name, "first");
    store.close();
  });
});
