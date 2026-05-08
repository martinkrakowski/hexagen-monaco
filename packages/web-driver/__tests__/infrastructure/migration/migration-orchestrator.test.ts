import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const MIGRATION_STATUS_KEY = "hexagen:migration-status";

interface MigrationResult {
  success: boolean;
  recordsMigrated: number;
  errors: string[];
}

interface MigrationStep {
  id: string;
  description: string;
  migrate(): Promise<MigrationResult>;
  verify(): Promise<boolean>;
}

interface MigrationStatus {
  completedSteps: string[];
  pendingSteps: string[];
  lastRunAt: string | null;
}

class MigrationOrchestrator {
  private steps: MigrationStep[];
  private completedSteps: Set<string> = new Set();
  private _lastRunAt: string | null = null;
  private migrationPromise: Promise<MigrationResult[]> | null = null;

  constructor(steps: MigrationStep[]) {
    this.steps = steps;
    this.loadStatus();
  }

  get ready(): Promise<void> {
    return (
      this.migrationPromise?.then(
        () => {},
        () => {},
      ) ?? Promise.resolve()
    );
  }

  async runPending(): Promise<MigrationResult[]> {
    if (this.migrationPromise) return this.migrationPromise;

    const promise = this.executePending();
    this.migrationPromise = promise;
    promise
      .finally(() => {
        this.migrationPromise = null;
      })
      .catch(() => {});
    return promise;
  }

  private async executePending(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    for (const step of this.steps) {
      if (this.completedSteps.has(step.id)) continue;

      const result = await step.migrate();
      if (!result.success) {
        results.push(result);
        continue;
      }

      const verified = await step.verify();
      if (verified) {
        this.completedSteps.add(step.id);
        this.persistStatus();
      }

      results.push(result);
    }

    if (results.length > 0) {
      this._lastRunAt = new Date().toISOString();
      this.persistStatus();
    }

    return results;
  }

  getStatus(): MigrationStatus {
    return {
      completedSteps: Array.from(this.completedSteps),
      pendingSteps: this.steps
        .map((s) => s.id)
        .filter((id) => !this.completedSteps.has(id)),
      lastRunAt: this._lastRunAt,
    };
  }

  isComplete(stepId: string): boolean {
    return this.completedSteps.has(stepId);
  }

  private getStorage(): Storage | null {
    try {
      if (
        typeof window !== "undefined" &&
        typeof window.localStorage !== "undefined"
      ) {
        return window.localStorage;
      }
    } catch {
      // Node.js 22+ exposes localStorage as a getter that throws SecurityError
    }
    return null;
  }

  private loadStatus(): void {
    const storage = this.getStorage();
    if (!storage) return;
    const stored = storage.getItem(MIGRATION_STATUS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.completedSteps)) {
          this.completedSteps = new Set(parsed.completedSteps);
        }
        this._lastRunAt = parsed.lastRunAt ?? null;
      } catch {
        // Corrupt status — start fresh
      }
    }
  }

  private persistStatus(): void {
    const storage = this.getStorage();
    if (!storage) return;
    storage.setItem(
      MIGRATION_STATUS_KEY,
      JSON.stringify({
        completedSteps: Array.from(this.completedSteps),
        lastRunAt: this._lastRunAt,
      }),
    );
  }
}

function createMockStorage() {
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

function createStep(
  id: string,
  migrateResult: MigrationResult,
  verifyResult: boolean,
): MigrationStep & { _migrateCalled: () => number } {
  let migrateCalled = 0;
  return {
    id,
    description: `Step ${id}`,
    migrate: async () => {
      migrateCalled++;
      return migrateResult;
    },
    verify: async () => verifyResult,
    _migrateCalled: () => migrateCalled,
  } as MigrationStep & { _migrateCalled: () => number };
}

describe("MigrationOrchestrator", () => {
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
    (globalThis as any).window = { localStorage: mockStorage };
  });

  describe("idempotency", () => {
    it("second run is a no-op when all steps completed", async () => {
      const step = createStep(
        "step-1",
        { success: true, recordsMigrated: 1, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      const firstRun = await orchestrator.runPending();
      assert.strictEqual(firstRun.length, 1);

      const secondRun = await orchestrator.runPending();
      assert.strictEqual(secondRun.length, 0);
      assert.strictEqual(step._migrateCalled(), 1);
    });

    it("skips already-completed steps on subsequent orchestrator instances", async () => {
      const step1 = createStep(
        "step-1",
        { success: true, recordsMigrated: 1, errors: [] },
        true,
      );
      const step2 = createStep(
        "step-2",
        { success: true, recordsMigrated: 2, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step1, step2]);

      await orchestrator.runPending();

      const newStep = createStep(
        "step-3",
        { success: true, recordsMigrated: 3, errors: [] },
        true,
      );
      const orchestrator2 = new MigrationOrchestrator([step1, step2, newStep]);
      const results = await orchestrator2.runPending();

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].recordsMigrated, 3);
    });
  });

  describe("status tracking", () => {
    it("reports all steps as pending initially", () => {
      const step1 = createStep(
        "step-a",
        { success: true, recordsMigrated: 0, errors: [] },
        true,
      );
      const step2 = createStep(
        "step-b",
        { success: true, recordsMigrated: 0, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step1, step2]);

      const status = orchestrator.getStatus();
      assert.deepStrictEqual(status.completedSteps, []);
      assert.deepStrictEqual(status.pendingSteps, ["step-a", "step-b"]);
      assert.strictEqual(status.lastRunAt, null);
    });

    it("updates status after running", async () => {
      const step = createStep(
        "step-a",
        { success: true, recordsMigrated: 1, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      await orchestrator.runPending();

      const status = orchestrator.getStatus();
      assert.deepStrictEqual(status.completedSteps, ["step-a"]);
      assert.deepStrictEqual(status.pendingSteps, []);
      assert.ok(status.lastRunAt !== null);
    });
  });

  describe("ready", () => {
    it("resolves immediately when runPending has not been called", async () => {
      const step = createStep(
        "step-r1",
        { success: true, recordsMigrated: 0, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      await assert.doesNotReject(() => orchestrator.ready);
    });

    it("resolves after runPending completes", async () => {
      const step = createStep(
        "step-r2",
        { success: true, recordsMigrated: 1, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      const runPromise = orchestrator.runPending();
      const readyPromise = orchestrator.ready;

      await runPromise;
      await assert.doesNotReject(() => readyPromise);
    });

    it("resolves even when a step fails", async () => {
      const step = createStep(
        "step-r3",
        { success: false, recordsMigrated: 0, errors: ["boom"] },
        false,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      const runPromise = orchestrator.runPending();
      const readyPromise = orchestrator.ready;

      const results = await runPromise;
      assert.strictEqual(results.length, 1);
      await assert.doesNotReject(() => readyPromise);
    });

    it("absorbs rejection from a throwing step", async () => {
      const thrown = new Error("kaboom");
      const failingStep: MigrationStep = {
        id: "step-throw",
        description: "Throws",
        migrate: () => Promise.reject(thrown),
        verify: async () => true,
      };
      const orchestrator = new MigrationOrchestrator([failingStep]);

      const runPromise = orchestrator.runPending();
      const readyPromise = orchestrator.ready;

      await assert.doesNotReject(() => readyPromise);
      await assert.rejects(() => runPromise);
    });

    it("returns a new promise identity after runPending is called", async () => {
      const step = createStep(
        "step-r4",
        { success: true, recordsMigrated: 1, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      const beforeReady = orchestrator.ready;
      orchestrator.runPending();
      const afterReady = orchestrator.ready;

      assert.strictEqual(beforeReady === afterReady, false);
      await afterReady;
    });
  });

  describe("step completion tracking", () => {
    it("isComplete returns false for unrun steps", () => {
      const step = createStep(
        "step-x",
        { success: true, recordsMigrated: 0, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      assert.strictEqual(orchestrator.isComplete("step-x"), false);
    });

    it("isComplete returns true after successful migration and verification", async () => {
      const step = createStep(
        "step-x",
        { success: true, recordsMigrated: 1, errors: [] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      await orchestrator.runPending();

      assert.strictEqual(orchestrator.isComplete("step-x"), true);
    });

    it("does not mark step complete when verification fails", async () => {
      const step = createStep(
        "step-y",
        { success: true, recordsMigrated: 1, errors: [] },
        false,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      await orchestrator.runPending();

      assert.strictEqual(orchestrator.isComplete("step-y"), false);
    });

    it("does not mark step complete when migration fails", async () => {
      const step = createStep(
        "step-z",
        { success: false, recordsMigrated: 0, errors: ["err"] },
        true,
      );
      const orchestrator = new MigrationOrchestrator([step]);

      await orchestrator.runPending();

      assert.strictEqual(orchestrator.isComplete("step-z"), false);
    });
  });
});
