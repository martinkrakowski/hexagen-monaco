import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ok, err, type Result } from "../domain/result.js";
import type { ImpactAnalysisRequest } from "./impact-analyzer.js";
import { ImpactAnalyzer } from "./impact-analyzer.js";
import { RefactoringEngine } from "./refactoring-engine.js";
import type { RefactoringResult } from "./refactoring-patterns/base-pattern.js";
import type { Manifest } from "../types/manifest.js";
import {
  createBackupBranch,
  rollbackFromBackup,
  deleteBackupBranch,
} from "./git-operations.js";
import { validate } from "./validation-suite.js";
import type {
  SafeRefactoringConfig,
  ValidationResult,
} from "./validation-suite.js";

const execAsync = promisify(exec);

interface SafeRefactoringResult extends RefactoringResult {
  validation: ValidationResult;
  backupBranch?: string;
  committed: boolean;
}

class SafeRefactoringOrchestrator {
  private impactAnalyzer: ImpactAnalyzer;
  private refactoringEngine: RefactoringEngine;

  constructor(
    private readonly workspaceRoot: string,
    private readonly manifest: Manifest,
  ) {
    this.impactAnalyzer = new ImpactAnalyzer(workspaceRoot, manifest);
    this.refactoringEngine = new RefactoringEngine(workspaceRoot);
  }

  async executeWithValidation(
    request: ImpactAnalysisRequest,
    config: SafeRefactoringConfig,
  ): Promise<Result<SafeRefactoringResult, Error>> {
    let backupBranch: string | null = null;
    let originalBranch: string | null = null;

    try {
      const impactResult = await this.impactAnalyzer.analyze(request);
      if (!impactResult.success) {
        return err(impactResult.error);
      }

      if (config.createBackup) {
        const backupResult = await createBackupBranch(this.workspaceRoot);
        if (!backupResult.success) {
          return err(backupResult.error);
        }
        backupBranch = backupResult.value.backupBranch;
        originalBranch = backupResult.value.originalBranch;
      }

      const refactoringResult = await this.refactoringEngine.execute(
        request,
        impactResult.value,
      );

      if (!refactoringResult.success) {
        if (backupBranch && originalBranch) {
          await rollbackFromBackup(
            this.workspaceRoot,
            originalBranch,
            backupBranch,
          );
        }
        return err(refactoringResult.error);
      }

      const validationResult = await validate(this.workspaceRoot, config);

      if (!validationResult.valid) {
        if (backupBranch && originalBranch) {
          await rollbackFromBackup(
            this.workspaceRoot,
            originalBranch,
            backupBranch,
          );
        }
        return err(
          new Error(`Validation failed: ${validationResult.errors.join(", ")}`),
        );
      }

      let committed = false;
      if (config.autoCommit) {
        const commitResult = await this.commitChanges(
          config.commitMessage ||
            `refactor: ${request.type} ${request.target} → ${request.newName || ""}`,
        );
        if (commitResult.success) {
          committed = true;
        }
      }

      if (backupBranch) {
        await deleteBackupBranch(this.workspaceRoot, backupBranch);
      }

      return ok({
        ...refactoringResult.value,
        validation: validationResult,
        backupBranch: backupBranch || undefined,
        committed,
      });
    } catch (error) {
      if (backupBranch && originalBranch) {
        await rollbackFromBackup(
          this.workspaceRoot,
          originalBranch,
          backupBranch,
        );
      }
      return err(error as Error);
    }
  }

  private async commitChanges(message: string): Promise<Result<void, Error>> {
    try {
      await execAsync("git add -A", { cwd: this.workspaceRoot });

      await execAsync(`git commit -m "${message}"`, {
        cwd: this.workspaceRoot,
      });

      return ok(undefined);
    } catch (error) {
      return err(
        new Error(`Failed to commit changes: ${(error as Error).message}`),
      );
    }
  }

  static getDefaultConfig(): SafeRefactoringConfig {
    return {
      createBackup: true,
      runBuild: true,
      runTypecheck: true,
      runArchLint: true,
      runTests: false,
      autoCommit: false,
    };
  }

  static getFastConfig(): SafeRefactoringConfig {
    return {
      createBackup: true,
      runBuild: false,
      runTypecheck: true,
      runArchLint: false,
      runTests: false,
      autoCommit: false,
    };
  }

  static getFullConfig(): SafeRefactoringConfig {
    return {
      createBackup: true,
      runBuild: true,
      runTypecheck: true,
      runArchLint: true,
      runTests: true,
      autoCommit: false,
    };
  }
}

export {
  SafeRefactoringOrchestrator,
  type SafeRefactoringConfig,
  type SafeRefactoringResult,
  type ValidationResult,
};
