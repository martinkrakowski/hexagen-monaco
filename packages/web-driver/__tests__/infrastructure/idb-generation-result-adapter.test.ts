import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";

type StoredValue = {
  projectId: string;
  timestamp: number;
  files: Record<string, string>;
  manifestYaml: string;
  source: "local" | "cloud" | "server";
};

function createMockStore() {
  const store = new Map<string, StoredValue>();
  return {
    async get(key: string): Promise<StoredValue | undefined> {
      return store.get(key);
    },
    async set(key: string, value: StoredValue): Promise<void> {
      store.set(key, value);
    },
    async del(key: string): Promise<void> {
      store.delete(key);
    },
    async keys(): Promise<string[]> {
      return Array.from(store.keys());
    },
    _store: store,
  };
}

const GENERATION_KEY_PREFIX = "hexagen:generation:";

function makeKey(projectId: string, timestamp: number): string {
  return `${GENERATION_KEY_PREFIX}${projectId}-${timestamp}`;
}

function createAdapterWithMock(mockStore: ReturnType<typeof createMockStore>) {
  return {
    async saveResult(result: StoredValue) {
      try {
        const key = makeKey(result.projectId, result.timestamp);
        await mockStore.set(key, result);
        return { success: true as const, value: undefined };
      } catch (e) {
        return {
          success: false as const,
          error: {
            kind: "SerializationFailed" as const,
            message: "Failed to save generation result",
            cause: e,
          },
        };
      }
    },

    async loadResults(projectId: string) {
      try {
        const allKeys = await mockStore.keys();
        const prefix = `${GENERATION_KEY_PREFIX}${projectId}-`;
        const projectKeys = allKeys.filter((k) => k.startsWith(prefix));

        const results: StoredValue[] = [];
        for (const key of projectKeys) {
          const data = await mockStore.get(key);
          if (data) results.push(data);
        }

        results.sort((a, b) => b.timestamp - a.timestamp);
        return { success: true as const, value: results };
      } catch (e) {
        return {
          success: false as const,
          error: {
            kind: "DeserializationFailed" as const,
            message: "Failed to load generation results",
            cause: e,
          },
        };
      }
    },

    async deleteResult(projectId: string, timestamp: number) {
      try {
        const key = makeKey(projectId, timestamp);
        await mockStore.del(key);
        return { success: true as const, value: undefined };
      } catch (e) {
        return {
          success: false as const,
          error: {
            kind: "Unknown" as const,
            message: "Failed to delete generation result",
            cause: e,
          },
        };
      }
    },

    async purgeProjectResults(projectId: string) {
      try {
        const allKeys = await mockStore.keys();
        const prefix = `${GENERATION_KEY_PREFIX}${projectId}-`;
        const projectKeys = allKeys.filter((k) => k.startsWith(prefix));

        for (const key of projectKeys) {
          await mockStore.del(key);
        }
        return { success: true as const, value: undefined };
      } catch (e) {
        return {
          success: false as const,
          error: {
            kind: "Unknown" as const,
            message: "Failed to purge generation results",
            cause: e,
          },
        };
      }
    },
  };
}

describe("IDBGenerationResultAdapter", () => {
  let mockStore: ReturnType<typeof createMockStore>;
  let adapter: ReturnType<typeof createAdapterWithMock>;

  beforeEach(() => {
    mockStore = createMockStore();
    adapter = createAdapterWithMock(mockStore);
  });

  describe("save + load roundtrip", () => {
    it("saves a result and loads it back", async () => {
      const result: StoredValue = {
        projectId: "proj-1",
        timestamp: 1000,
        files: { "main.ts": "console.log('hello')" },
        manifestYaml: "name: test",
        source: "local",
      };

      const saveRes = await adapter.saveResult(result);
      assert.strictEqual(saveRes.success, true);

      const loadRes = await adapter.loadResults("proj-1");
      assert.strictEqual(loadRes.success, true);
      if (!loadRes.success) return;
      assert.strictEqual(loadRes.value.length, 1);
      assert.strictEqual(loadRes.value[0].projectId, "proj-1");
      assert.strictEqual(loadRes.value[0].timestamp, 1000);
      assert.strictEqual(loadRes.value[0].source, "local");
    });

    it("returns results sorted by timestamp descending", async () => {
      await adapter.saveResult({
        projectId: "proj-1",
        timestamp: 1000,
        files: {},
        manifestYaml: "",
        source: "local",
      });
      await adapter.saveResult({
        projectId: "proj-1",
        timestamp: 3000,
        files: {},
        manifestYaml: "",
        source: "cloud",
      });
      await adapter.saveResult({
        projectId: "proj-1",
        timestamp: 2000,
        files: {},
        manifestYaml: "",
        source: "server",
      });

      const loadRes = await adapter.loadResults("proj-1");
      assert.strictEqual(loadRes.success, true);
      if (!loadRes.success) return;
      assert.strictEqual(loadRes.value.length, 3);
      assert.strictEqual(loadRes.value[0].timestamp, 3000);
      assert.strictEqual(loadRes.value[1].timestamp, 2000);
      assert.strictEqual(loadRes.value[2].timestamp, 1000);
    });

    it("does not return results from other projects", async () => {
      await adapter.saveResult({
        projectId: "proj-1",
        timestamp: 1000,
        files: {},
        manifestYaml: "",
        source: "local",
      });
      await adapter.saveResult({
        projectId: "proj-2",
        timestamp: 1000,
        files: {},
        manifestYaml: "",
        source: "local",
      });

      const loadRes = await adapter.loadResults("proj-1");
      assert.strictEqual(loadRes.success, true);
      if (!loadRes.success) return;
      assert.strictEqual(loadRes.value.length, 1);
      assert.strictEqual(loadRes.value[0].projectId, "proj-1");
    });

    it("returns empty array for project with no results", async () => {
      const loadRes = await adapter.loadResults("nonexistent");
      assert.strictEqual(loadRes.success, true);
      if (!loadRes.success) return;
      assert.strictEqual(loadRes.value.length, 0);
    });
  });

  describe("delete", () => {
    it("deletes a specific result by projectId and timestamp", async () => {
      await adapter.saveResult({
        projectId: "proj-1",
        timestamp: 1000,
        files: {},
        manifestYaml: "",
        source: "local",
      });
      await adapter.saveResult({
        projectId: "proj-1",
        timestamp: 2000,
        files: {},
        manifestYaml: "",
        source: "local",
      });

      const delRes = await adapter.deleteResult("proj-1", 1000);
      assert.strictEqual(delRes.success, true);

      const loadRes = await adapter.loadResults("proj-1");
      assert.strictEqual(loadRes.success, true);
      if (!loadRes.success) return;
      assert.strictEqual(loadRes.value.length, 1);
      assert.strictEqual(loadRes.value[0].timestamp, 2000);
    });
  });

  describe("purge by projectId", () => {
    it("deletes all results for a project", async () => {
      await adapter.saveResult({
        projectId: "proj-1",
        timestamp: 1000,
        files: {},
        manifestYaml: "",
        source: "local",
      });
      await adapter.saveResult({
        projectId: "proj-1",
        timestamp: 2000,
        files: {},
        manifestYaml: "",
        source: "local",
      });
      await adapter.saveResult({
        projectId: "proj-2",
        timestamp: 1000,
        files: {},
        manifestYaml: "",
        source: "local",
      });

      const purgeRes = await adapter.purgeProjectResults("proj-1");
      assert.strictEqual(purgeRes.success, true);

      const loadProj1 = await adapter.loadResults("proj-1");
      assert.strictEqual(loadProj1.success, true);
      if (!loadProj1.success) return;
      assert.strictEqual(loadProj1.value.length, 0);

      const loadProj2 = await adapter.loadResults("proj-2");
      assert.strictEqual(loadProj2.success, true);
      if (!loadProj2.success) return;
      assert.strictEqual(loadProj2.value.length, 1);
    });
  });
});
