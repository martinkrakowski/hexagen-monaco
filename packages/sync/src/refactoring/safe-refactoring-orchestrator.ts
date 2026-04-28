// safe-refactoring-orchestrator.ts – Safe refactoring with validation and rollback
// Part of Phase 7: Refactoring Assistant
//
// This orchestrator provides safe refactoring execution:
// 1. Creates backup branch before changes
// 2. Executes refactoring
// 3. Runs validation suite (build, typecheck, lint, test)
// 4. Rolls back on failure
// 5. Commits on success

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ok, err, type Result } from "../domain/result.js";
import type { ImpactAnalysisRequest } from "./impact-analyzer.js";
import { ImpactAnalyzer } from "./impact-analyzer.js";
import { RefactoringEngine } from "./refactoring-engine.js";
import type { RefactoringResult } from "./refactoring-patterns/base-pattern.js";
import type { Manifest } from "../types/manifest.js";

const execAsync = promisify(exec);

/**
 * Configuration for safe refactoring execution
 */
export interface SafeRefactoringConfig {
  /** Create backup branch before refactoring */
  createBackup: boolean;
  /** Run yarn build after refactoring */
  runBuild: boolean;
  /** Run yarn typecheck after refactoring */
  runTypecheck: boolean;
  /** Run yarn lint:arch after refactoring */
  runArchLint: boolean;
  /** Run yarn test after refactoring */
  runTests: boolean;
  /** Automatically commit changes on success */
  autoCommit: boolean;
  /** Custom commit message (if autoCommit is true) */
  commitMessage?: string;
}

/**
 * Result of validation suite execution
 */
export interface ValidationResult {
  valid: boolean;
  buildPassed: boolean;
  typecheckPassed: boolean;
  archLintPassed: boolean;
  testsPassed: boolean;
  errors: string[];
}

/**
 * Combined result of refactoring and validation
 */
export interface SafeRefactoringResult extends RefactoringResult {
  validation: ValidationResult;
  backupBranch?: string;
  committed: boolean;
}

/**
 * Orchestrates safe refactoring with validation and rollback
 */
export class SafeRefactoringOrchestrator {
  private impactAnalyzer: ImpactAnalyzer;
  private refactoringEngine: RefactoringEngine;

  constructor(
    private readonly workspaceRoot: string,
    private readonly manifest: Manifest,
  ) {
    this.impactAnalyzer = new ImpactAnalyzer(workspaceRoot, manifest);
    this.refactoringEngine = new RefactoringEngine(workspaceRoot);
  }

  /**
   * Execute refactoring with validation and rollback capability
   *
   * @param request - The refactoring request
   * @param config - Safe refactoring configuration
   * @returns Result with refactoring outcome and validation results
   */
  async executeWithValidation(
    request: ImpactAnalysisRequest,
    config: SafeRefactoringConfig,
  ): Promise<Result<SafeRefactoringResult, Error>> {
    let backupBranch: string | null = null;
    let originalBranch: string | null = null;

    try {
      // 1. Analyze impact
      const impactResult = await this.impactAnalyzer.analyze(request);
      if (!impactResult.success) {
        return err(impactResult.error);
      }

      // 2. Create backup branch if enabled
      if (config.createBackup) {
        const backupResult = await this.createBackupBranch();
        if (!backupResult.success) {
          return err(backupResult.error);
        }
        backupBranch = backupResult.value.backupBranch;
        originalBranch = backupResult.value.originalBranch;
      }

      // 3. Execute refactoring
      const refactoringResult = await this.refactoringEngine.execute(
        request,
        impactResult.value,
      );

      if (!refactoringResult.success) {
        // Rollback if refactoring failed
        if (backupBranch && originalBranch) {
          await this.rollbackFromBackup(originalBranch, backupBranch);
        }
        return err(refactoringResult.error);
      }

      // 4. Run validation suite
      const validationResult = await this.validate(config);

      if (!validationResult.valid) {
        // Rollback if validation failed
        if (backupBranch && originalBranch) {
          await this.rollbackFromBackup(originalBranch, backupBranch);
        }
        return err(
          new Error(`Validation failed: ${validationResult.errors.join(", ")}`),
        );
      }

      // 5. Commit changes if enabled
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

      // 6. Clean up backup branch
      if (backupBranch) {
        await this.deleteBackupBranch(backupBranch);
      }

      return ok({
        ...refactoringResult.value,
        validation: validationResult,
        backupBranch: backupBranch || undefined,
        committed,
      });
    } catch (error) {
      // Rollback on any unexpected error
      if (backupBranch && originalBranch) {
        await this.rollbackFromBackup(originalBranch, backupBranch);
      }
      return err(error as Error);
    }
  }

  /**
   * Create a backup branch before making changes
   */
  private async createBackupBranch(): Promise<
    Result<{ backupBranch: string; originalBranch: string }, Error>
  > {
    try {
      // Get current branch name
      const { stdout: currentBranch } = await execAsync(
        "git rev-parse --abbrev-ref HEAD",
        { cwd: this.workspaceRoot },
      );
      const originalBranch = currentBranch.trim();

      // Create backup branch name with timestamp
      const timestamp = Date.now();
      const backupBranch = `refactor-backup-${timestamp}`;

      // Create and checkout backup branch
      await execAsync(`git checkout -b ${backupBranch}`, {
        cwd: this.workspaceRoot,
      });

      // Switch back to original branch
      await execAsync(`git checkout ${originalBranch}`, {
        cwd: this.workspaceRoot,
      });

      return ok({ backupBranch, originalBranch });
    } catch (error) {
      return err(
        new Error(
          `Failed to create backup branch: ${(error as Error).message}`,
        ),
      );
    }
  }

  /**
   * Rollback changes by restoring from backup branch
   */
  private async rollbackFromBackup(
    originalBranch: string,
    backupBranch: string,
  ): Promise<Result<void, Error>> {
    try {
      // Checkout original branch
      await execAsync(`git checkout ${originalBranch}`, {
        cwd: this.workspaceRoot,
      });

      // Reset to backup branch state
      await execAsync(`git reset --hard ${backupBranch}`, {
        cwd: this.workspaceRoot,
      });

      // Delete backup branch
      await this.deleteBackupBranch(backupBranch);

      return ok(undefined);
    } catch (error) {
      return err(
        new Error(
          `Failed to rollback from backup: ${(error as Error).message}`,
        ),
      );
    }
  }

  /**
   * Delete backup branch
   */
  private async deleteBackupBranch(
    backupBranch: string,
  ): Promise<Result<void, Error>> {
    try {
      await execAsync(`git branch -D ${backupBranch}`, {
        cwd: this.workspaceRoot,
      });
      return ok(undefined);
    } catch {
      // Non-critical error - log but don't fail
      return ok(undefined);
    }
  }

  /**
   * Run validation suite
   */
  private async validate(
    config: SafeRefactoringConfig,
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      buildPassed: true,
      typecheckPassed: true,
      archLintPassed: true,
      testsPassed: true,
      errors: [],
    };

    // Run build
    if (config.runBuild) {
      try {
        await execAsync("yarn build", {
          cwd: this.workspaceRoot,
          timeout: 120_000, // 2 minutes
        });
      } catch (error) {
        result.buildPassed = false;
        result.valid = false;
        result.errors.push(`Build failed: ${(error as Error).message}`);
      }
    }

    // Run typecheck
    if (config.runTypecheck) {
      try {
        await execAsync("yarn typecheck", {
          cwd: this.workspaceRoot,
          timeout: 120_000, // 2 minutes
        });
      } catch (error) {
        result.typecheckPassed = false;
        result.valid = false;
        result.errors.push(`Typecheck failed: ${(error as Error).message}`);
      }
    }

    // Run arch lint
    if (config.runArchLint) {
      try {
        await execAsync("yarn lint:arch", {
          cwd: this.workspaceRoot,
          timeout: 60_000, // 1 minute
        });
      } catch (error) {
        result.archLintPassed = false;
        result.valid = false;
        result.errors.push(`Arch lint failed: ${(error as Error).message}`);
      }
    }

    // Run tests
    if (config.runTests) {
      try {
        await execAsync("yarn test", {
          cwd: this.workspaceRoot,
          timeout: 300_000, // 5 minutes
        });
      } catch (error) {
        result.testsPassed = false;
        result.valid = false;
        result.errors.push(`Tests failed: ${(error as Error).message}`);
      }
    }

    return result;
  }

  /**
   * Commit changes with a message
   */
  private async commitChanges(message: string): Promise<Result<void, Error>> {
    try {
      // Stage all changes
      await execAsync("git add -A", { cwd: this.workspaceRoot });

      // Commit with message
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

  /**
   * Get default safe refactoring configuration
   */
  static getDefaultConfig(): SafeRefactoringConfig {
    return {
      createBackup: true,
      runBuild: true,
      runTypecheck: true,
      runArchLint: true,
      runTests: false, // Tests can be slow, make optional
      autoCommit: false, // Require explicit commit
    };
  }

  /**
   * Get fast validation configuration (skip tests)
   */
  static getFastConfig(): SafeRefactoringConfig {
    return {
      createBackup: true,
      runBuild: true,
      runTypecheck: true,
      runArchLint: true,
      runTests: false,
      autoCommit: false,
    };
  }

  /**
   * Get full validation configuration (including tests)
   */
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

// Made with Bob
