export interface MigrationStep {
  id: string;
  description: string;
  migrate(): Promise<MigrationResult>;
  verify(): Promise<boolean>;
}

export interface MigrationResult {
  success: boolean;
  recordsMigrated: number;
  errors: string[];
}

export interface MigrationStatus {
  completedSteps: string[];
  pendingSteps: string[];
  lastRunAt: number | null;
}

export class MigrationOrchestrator {
  private steps: MigrationStep[];
  private statusKey = "hexagen:migration:status";
  private migrationPromise: Promise<MigrationResult[]> | null = null;

  constructor(steps: MigrationStep[]) {
    this.steps = steps;
  }

  get ready(): Promise<void> {
    return this.migrationPromise?.then(() => {}) ?? Promise.resolve();
  }

  async runPending(): Promise<MigrationResult[]> {
    if (typeof window === "undefined") return [];
    if (this.migrationPromise) return this.migrationPromise;

    const promise = this.executePending();
    this.migrationPromise = promise;
    promise.finally(() => {
      this.migrationPromise = null;
    });
    return promise;
  }

  private async executePending(): Promise<MigrationResult[]> {
    const status = this.getStatus();
    const pending = this.steps.filter(
      (step) => !status.completedSteps.includes(step.id),
    );

    if (pending.length === 0) {
      return [];
    }

    const results: MigrationResult[] = [];

    for (const step of pending) {
      const result = await step.migrate();
      results.push(result);

      if (result.success) {
        const verified = await step.verify();
        if (verified) {
          this.markComplete(step.id);
        }
      }
    }

    this.updateLastRun();

    return results;
  }

  getStatus(): MigrationStatus {
    if (typeof window === "undefined") {
      return {
        completedSteps: [],
        pendingSteps: this.steps.map((s) => s.id),
        lastRunAt: null,
      };
    }

    const raw = localStorage.getItem(this.statusKey);
    if (!raw) {
      return {
        completedSteps: [],
        pendingSteps: this.steps.map((s) => s.id),
        lastRunAt: null,
      };
    }

    try {
      const parsed = JSON.parse(raw) as {
        completedSteps: string[];
        lastRunAt: number | null;
      };
      return {
        completedSteps: parsed.completedSteps ?? [],
        pendingSteps: this.steps
          .map((s) => s.id)
          .filter((id) => !parsed.completedSteps?.includes(id)),
        lastRunAt: parsed.lastRunAt ?? null,
      };
    } catch {
      return {
        completedSteps: [],
        pendingSteps: this.steps.map((s) => s.id),
        lastRunAt: null,
      };
    }
  }

  isComplete(stepId: string): boolean {
    const status = this.getStatus();
    return status.completedSteps.includes(stepId);
  }

  private markComplete(stepId: string): void {
    if (typeof window === "undefined") return;

    const status = this.getStatus();
    if (!status.completedSteps.includes(stepId)) {
      status.completedSteps.push(stepId);
    }
    localStorage.setItem(this.statusKey, JSON.stringify(status));
  }

  private updateLastRun(): void {
    if (typeof window === "undefined") return;

    const status = this.getStatus();
    status.lastRunAt = Date.now();
    localStorage.setItem(this.statusKey, JSON.stringify(status));
  }
}
