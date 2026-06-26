import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";

function createMockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    get length(): number {
      return store.size;
    },
    key(index: number): string | null {
      const keys = Array.from(store.keys());
      return keys[index] ?? null;
    },
    _store: store,
  };
}

type MockLocalStorage = ReturnType<typeof createMockLocalStorage>;

function createMonitorWithMock(mockStorage: MockLocalStorage) {
  const listeners = new Set<(status: any) => void>();

  const TOTAL_BYTES = 5 * 1024 * 1024;
  const NEAR_QUOTA_THRESHOLD = 0.8;
  const CRITICAL_QUOTA_THRESHOLD = 0.95;
  const WORKSPACE_KEY_PREFIX = "hexagen-editor-workspace-";
  const SAVED_PROJECTS_LS_KEY = "hexagen-saved-projects";
  const SAVED_PROJECTS_IDB_KEY = "hexagen:saved-projects";
  const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  let cachedStatus: any | null = null;

  function computeUsedBytes(): number {
    let total = 0;
    for (const [key, value] of mockStorage._store.entries()) {
      total += new Blob([key]).size + new Blob([value]).size;
    }
    return total;
  }

  function computeStatus() {
    const usedBytes = computeUsedBytes();
    const usagePercent = (usedBytes / TOTAL_BYTES) * 100;
    return {
      usedBytes,
      totalBytes: TOTAL_BYTES,
      usagePercent,
      isNearQuota: usagePercent >= NEAR_QUOTA_THRESHOLD * 100,
      isCritical: usagePercent >= CRITICAL_QUOTA_THRESHOLD * 100,
    };
  }

  function getStatus() {
    if (!cachedStatus) {
      cachedStatus = computeStatus();
    }
    return cachedStatus;
  }

  function invalidateCache(): void {
    cachedStatus = null;
    const status = getStatus();
    for (const cb of listeners) {
      cb(status);
    }
  }

  return {
    getStatus,

    onStatusChange(callback: (status: any) => void): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    trimOldWorkspaceSessions(maxAgeMs: number = DEFAULT_MAX_AGE_MS): number {
      const cutoff = Date.now() - maxAgeMs;
      let trimmed = 0;
      const keysToRemove: string[] = [];

      for (const [key, raw] of mockStorage._store.entries()) {
        if (!key.startsWith(WORKSPACE_KEY_PREFIX)) continue;
        try {
          const parsed = JSON.parse(raw);
          if (
            typeof parsed.updatedAt === "number" &&
            parsed.updatedAt < cutoff
          ) {
            keysToRemove.push(key);
          }
        } catch {
          continue;
        }
      }

      for (const key of keysToRemove) {
        mockStorage.removeItem(key);
        trimmed++;
      }

      if (trimmed > 0) {
        invalidateCache();
      }
      return trimmed;
    },

    getLruSavedProjectIds(): string[] {
      const raw =
        mockStorage.getItem(SAVED_PROJECTS_IDB_KEY) ??
        mockStorage.getItem(SAVED_PROJECTS_LS_KEY);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return [...parsed]
          .filter(
            (p: any) =>
              typeof p.id === "string" && typeof p.updatedAt === "number",
          )
          .sort((a: any, b: any) => a.updatedAt - b.updatedAt)
          .map((p: any) => p.id);
      } catch {
        return [];
      }
    },

    invalidateCache,

    _listeners: listeners,
  };
}

describe("StorageQuotaMonitor", () => {
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
  });

  describe("getStatus()", () => {
    it("returns zero usage for empty storage", () => {
      const monitor = createMonitorWithMock(mockStorage);
      const status = monitor.getStatus();
      assert.strictEqual(status.usedBytes, 0);
      assert.strictEqual(status.totalBytes, 5 * 1024 * 1024);
      assert.strictEqual(status.usagePercent, 0);
      assert.strictEqual(status.isNearQuota, false);
      assert.strictEqual(status.isCritical, false);
    });

    it("measures usage of stored items", () => {
      mockStorage.setItem("test-key", "test-value");
      const monitor = createMonitorWithMock(mockStorage);
      const status = monitor.getStatus();
      assert.ok(status.usedBytes > 0);
      assert.ok(status.usagePercent > 0);
    });

    it("detects near quota when usage >= 80%", () => {
      const value = "x".repeat(4 * 1024 * 1024);
      mockStorage.setItem("big-key", value);
      const monitor = createMonitorWithMock(mockStorage);
      const status = monitor.getStatus();
      assert.strictEqual(status.isNearQuota, true);
      assert.strictEqual(status.isCritical, false);
    });

    it("detects critical when usage >= 95%", () => {
      const value = "x".repeat(5 * 1024 * 1024 - 100);
      mockStorage.setItem("huge-key", value);
      const monitor = createMonitorWithMock(mockStorage);
      const status = monitor.getStatus();
      assert.strictEqual(status.isCritical, true);
    });
  });

  describe("trimOldWorkspaceSessions()", () => {
    it("trims workspace sessions older than maxAgeMs", () => {
      const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const recentTimestamp = Date.now() - 1 * 24 * 60 * 60 * 1000;

      mockStorage.setItem(
        "hexagen-editor-workspace-session-old",
        JSON.stringify({
          schemaVersion: 1,
          sessionId: "old",
          updatedAt: oldTimestamp,
          selectedFileId: null,
          files: {},
        }),
      );
      mockStorage.setItem(
        "hexagen-editor-workspace-session-recent",
        JSON.stringify({
          schemaVersion: 1,
          sessionId: "recent",
          updatedAt: recentTimestamp,
          selectedFileId: null,
          files: {},
        }),
      );

      const monitor = createMonitorWithMock(mockStorage);
      const trimmed = monitor.trimOldWorkspaceSessions();

      assert.strictEqual(trimmed, 1);
      assert.strictEqual(
        mockStorage.getItem("hexagen-editor-workspace-session-old"),
        null,
      );
      assert.ok(
        mockStorage.getItem("hexagen-editor-workspace-session-recent") !== null,
      );
    });

    it("keeps all sessions when none are old enough", () => {
      const recentTimestamp = Date.now() - 1000;
      mockStorage.setItem(
        "hexagen-editor-workspace-session-1",
        JSON.stringify({
          schemaVersion: 1,
          sessionId: "1",
          updatedAt: recentTimestamp,
          selectedFileId: null,
          files: {},
        }),
      );

      const monitor = createMonitorWithMock(mockStorage);
      const trimmed = monitor.trimOldWorkspaceSessions();

      assert.strictEqual(trimmed, 0);
      assert.ok(
        mockStorage.getItem("hexagen-editor-workspace-session-1") !== null,
      );
    });

    it("ignores non-workspace keys", () => {
      mockStorage.setItem("other-key", JSON.stringify({ updatedAt: 0 }));
      const monitor = createMonitorWithMock(mockStorage);
      const trimmed = monitor.trimOldWorkspaceSessions();

      assert.strictEqual(trimmed, 0);
      assert.ok(mockStorage.getItem("other-key") !== null);
    });
  });

  describe("getLruSavedProjectIds()", () => {
    it("returns project IDs sorted by updatedAt ascending", () => {
      mockStorage.setItem(
        "hexagen-saved-projects",
        JSON.stringify([
          {
            id: "p3",
            name: "C",
            schemaVersion: 2,
            createdAt: 3000,
            updatedAt: 3000,
            formState: {},
            manifestYaml: "",
          },
          {
            id: "p1",
            name: "A",
            schemaVersion: 2,
            createdAt: 1000,
            updatedAt: 1000,
            formState: {},
            manifestYaml: "",
          },
          {
            id: "p2",
            name: "B",
            schemaVersion: 2,
            createdAt: 2000,
            updatedAt: 2000,
            formState: {},
            manifestYaml: "",
          },
        ]),
      );

      const monitor = createMonitorWithMock(mockStorage);
      const ids = monitor.getLruSavedProjectIds();

      assert.deepStrictEqual(ids, ["p1", "p2", "p3"]);
    });

    it("returns empty array when no projects exist", () => {
      const monitor = createMonitorWithMock(mockStorage);
      const ids = monitor.getLruSavedProjectIds();
      assert.deepStrictEqual(ids, []);
    });

    it("returns empty array for malformed data", () => {
      mockStorage.setItem("hexagen-saved-projects", "not-json");
      const monitor = createMonitorWithMock(mockStorage);
      const ids = monitor.getLruSavedProjectIds();
      assert.deepStrictEqual(ids, []);
    });

    it("filters out entries without id or updatedAt", () => {
      mockStorage.setItem(
        "hexagen-saved-projects",
        JSON.stringify([
          { id: "p1", updatedAt: 1000 },
          { name: "no-id" },
          { id: "p2" },
        ]),
      );

      const monitor = createMonitorWithMock(mockStorage);
      const ids = monitor.getLruSavedProjectIds();

      assert.deepStrictEqual(ids, ["p1"]);
    });

    it("prefers IDB key over LS key for saved projects", () => {
      mockStorage.setItem(
        "hexagen:saved-projects",
        JSON.stringify([{ id: "idb-p1", updatedAt: 1000 }]),
      );
      mockStorage.setItem(
        "hexagen-saved-projects",
        JSON.stringify([{ id: "ls-p1", updatedAt: 2000 }]),
      );

      const monitor = createMonitorWithMock(mockStorage);
      const ids = monitor.getLruSavedProjectIds();

      assert.deepStrictEqual(ids, ["idb-p1"]);
    });
  });

  describe("invalidateCache()", () => {
    it("causes getStatus to recompute after storage changes", () => {
      const monitor = createMonitorWithMock(mockStorage);
      const status1 = monitor.getStatus();
      assert.strictEqual(status1.usedBytes, 0);

      mockStorage.setItem("new-key", "some-value");
      const status2 = monitor.getStatus();
      assert.strictEqual(status2.usedBytes, 0);

      monitor.invalidateCache();
      const status3 = monitor.getStatus();
      assert.ok(status3.usedBytes > 0);
    });

    it("notifies listeners when near quota after invalidation", () => {
      const monitor = createMonitorWithMock(mockStorage);
      let warningCalled = false;
      monitor.onStatusChange(() => {
        warningCalled = true;
      });

      const value = "x".repeat(4 * 1024 * 1024);
      mockStorage.setItem("big-key", value);

      monitor.invalidateCache();

      assert.strictEqual(warningCalled, true);
    });

    it("notifies listeners on recovery from warning to OK", () => {
      const value = "x".repeat(4 * 1024 * 1024);
      mockStorage.setItem("big-key", value);

      const monitor = createMonitorWithMock(mockStorage);
      const statuses: any[] = [];
      monitor.onStatusChange((status) => {
        statuses.push(status);
      });

      mockStorage.removeItem("big-key");
      monitor.invalidateCache();

      assert.strictEqual(statuses.length, 1);
      assert.strictEqual(statuses[0].isNearQuota, false);
    });

    it("notifies listeners on Warning→OK round-trip", () => {
      const monitor = createMonitorWithMock(mockStorage);
      const statuses: any[] = [];
      monitor.onStatusChange((status) => {
        statuses.push(status);
      });

      const value = "x".repeat(4 * 1024 * 1024);
      mockStorage.setItem("big-key", value);
      monitor.invalidateCache();

      mockStorage.removeItem("big-key");
      monitor.invalidateCache();

      assert.strictEqual(statuses.length, 2);
      assert.strictEqual(statuses[0].isNearQuota, true);
      assert.strictEqual(statuses[1].isNearQuota, false);
    });

    it("notifies listeners on any status change after invalidation", () => {
      const monitor = createMonitorWithMock(mockStorage);
      let called = false;
      monitor.onStatusChange(() => {
        called = true;
      });

      mockStorage.setItem("small-key", "tiny");
      monitor.invalidateCache();

      assert.strictEqual(called, true);
    });
  });
});
