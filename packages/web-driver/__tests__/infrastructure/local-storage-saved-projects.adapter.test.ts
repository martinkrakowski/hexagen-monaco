import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

import { LocalStorageSavedProjectsAdapter } from "../../src/infrastructure/adapters/local-storage-saved-projects.adapter.js";
import type { SavedProject } from "@hexagen/shared";

// First direct coverage of the FROZEN legacy adapter's record-level methods.
// The headline pin is the interleave test: localStorage itself is synchronous,
// but the composed load-merge-save methods yield a microtask between read and
// write — without the adapter's write queue, two record ops started in the
// same tick would read the same array and the later write would discard the
// earlier one (the exact clobber class the record-level port contract closes).

const STORAGE_KEY = "hexagen-saved-projects";

function createMockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => store.clear(),
  };
}

function project(id: string, name: string): SavedProject {
  return {
    id,
    name,
    schemaVersion: 3,
    createdAt: 1,
    updatedAt: 1,
    formState: {} as SavedProject["formState"],
    manifestYaml: "",
  };
}

let mockStorage: ReturnType<typeof createMockLocalStorage>;

function storedProjects(): Array<{ id: string; name: string }> {
  const raw = mockStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Array<{ id: string; name: string }>) : [];
}

describe("LocalStorageSavedProjectsAdapter — record-level methods", () => {
  let adapter: LocalStorageSavedProjectsAdapter;

  beforeEach(() => {
    // The adapter gates on `typeof window` and uses the global `localStorage`.
    mockStorage = createMockLocalStorage();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", mockStorage);
    adapter = new LocalStorageSavedProjectsAdapter();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes record ops started in the same tick — neither update is clobbered", async () => {
    await adapter.saveProjects([project("p1", "One"), project("p2", "Two")]);

    // Deliberately NOT awaited in sequence: both read-merge-writes are in
    // flight together, which is the window the write queue must close.
    const [a, b] = await Promise.all([
      adapter.updateProjectRecord("p1", (p) => ({ ...p, name: "One*" })),
      adapter.updateProjectRecord("p2", (p) => ({ ...p, name: "Two*" })),
    ]);

    assert.ok(a.success && b.success);
    assert.deepStrictEqual(
      storedProjects().map((p) => p.name),
      ["One*", "Two*"],
    );
  });

  it("serializes a concurrent create + delete — both land", async () => {
    await adapter.saveProjects([project("p1", "One"), project("p2", "Two")]);

    const [created, deleted] = await Promise.all([
      adapter.createProjectRecord(project("p3", "Three")),
      adapter.deleteProjectRecord("p1"),
    ]);

    assert.ok(created.success && deleted.success);
    assert.deepStrictEqual(
      storedProjects()
        .map((p) => p.id)
        .sort(),
      ["p2", "p3"],
    );
  });

  it("createProjectRecord rejects a duplicate id with Conflict and prepends otherwise", async () => {
    await adapter.saveProjects([project("p1", "One")]);

    const duplicate = await adapter.createProjectRecord(project("p1", "Again"));
    assert.ok(!duplicate.success);
    assert.strictEqual(duplicate.error.kind, "Conflict");

    const created = await adapter.createProjectRecord(project("p0", "Newest"));
    assert.ok(created.success);
    assert.deepStrictEqual(
      storedProjects().map((p) => p.id),
      ["p0", "p1"],
    );
  });

  it("deleteProjectRecord is idempotent: an absent id resolves success without a write", async () => {
    await adapter.saveProjects([project("p1", "One")]);
    const before = mockStorage.getItem(STORAGE_KEY);

    const result = await adapter.deleteProjectRecord("ghost");

    assert.ok(result.success);
    assert.strictEqual(mockStorage.getItem(STORAGE_KEY), before);
  });

  it("updateProjectRecord returns NotFound for an absent id", async () => {
    await adapter.saveProjects([project("p1", "One")]);

    const result = await adapter.updateProjectRecord("ghost", (p) => p);

    assert.ok(!result.success);
    assert.strictEqual(result.error.kind, "NotFound");
  });
});
