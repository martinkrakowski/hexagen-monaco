import { describe, it } from "node:test";
import assert from "node:assert";
import { InitializeFeatureWorktreeUseCase } from "../../../src/application/use-cases/initialize-feature-worktree.use-case.js";
import { createFeatureId } from "../../../src/domain/value-objects/feature-id.js";
import type { ReportRepositoryPort } from "../../../src/application/ports/out/report-repository.port.js";
import type { FeatureReport } from "../../../src/domain/index.js";
import type { Result } from "@hexagen/shared";

class InMemoryReportRepository implements ReportRepositoryPort {
  public savedReports: Array<{ report: FeatureReport; projectRoot: string }> = [];
  private shouldFail = false;

  constructor(shouldFail = false) {
    this.shouldFail = shouldFail;
  }

  async save(report: FeatureReport, projectRoot: string): Promise<Result<void>> {
    if (this.shouldFail) {
      return { success: false, error: new Error("save failed") };
    }
    this.savedReports.push({ report, projectRoot });
    return { success: true, value: undefined };
  }

  async load(): Promise<Result<FeatureReport | null>> {
    return { success: true, value: null };
  }

  async appendPhaseReport(): Promise<Result<void>> {
    return { success: true, value: undefined };
  }
}

describe("InitializeFeatureWorktreeUseCase", () => {
  it("creates a report with phase 01-blueprint", async () => {
    const repo = new InMemoryReportRepository();
    const useCase = new InitializeFeatureWorktreeUseCase(repo);
    const featureId = createFeatureId("test-feature");
    const result = await useCase.execute(featureId, "/tmp/project");
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.currentPhase, "01-blueprint");
    }
  });

  it("calls save on the repository", async () => {
    const repo = new InMemoryReportRepository();
    const useCase = new InitializeFeatureWorktreeUseCase(repo);
    const featureId = createFeatureId("test-feature");
    await useCase.execute(featureId, "/tmp/project");
    assert.strictEqual(repo.savedReports.length, 1);
    assert.strictEqual(repo.savedReports[0].projectRoot, "/tmp/project");
  });

  it("returns error result when save fails", async () => {
    const repo = new InMemoryReportRepository(true);
    const useCase = new InitializeFeatureWorktreeUseCase(repo);
    const featureId = createFeatureId("test-feature");
    const result = await useCase.execute(featureId, "/tmp/project");
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof Error);
    }
  });
});
