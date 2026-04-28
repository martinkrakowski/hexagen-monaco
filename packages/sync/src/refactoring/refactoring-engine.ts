// refactoring-engine.ts – Refactoring engine that orchestrates pattern execution
// Part of Phase 7: Refactoring Assistant
//
// This engine:
// 1. Loads and registers refactoring patterns
// 2. Validates refactoring requests
// 3. Executes patterns with impact analysis results
// 4. Collects and reports results

import { err, type Result } from "../domain/result.js";
import type {
  ImpactAnalysisRequest,
  ImpactAnalysisResult,
} from "./impact-analyzer.js";
import type {
  RefactoringPattern,
  RefactoringResult,
} from "./refactoring-patterns/base-pattern.js";
import {
  RenamePortPattern,
  RenameUseCasePattern,
  RenameEntityPattern,
} from "./refactoring-patterns/index.js";

/**
 * Engine that orchestrates refactoring pattern execution
 */
export class RefactoringEngine {
  private patterns: Map<string, RefactoringPattern> = new Map();

  constructor(private readonly workspaceRoot: string) {
    this.registerPatterns();
  }

  /**
   * Register all available refactoring patterns
   */
  private registerPatterns(): void {
    const patterns: RefactoringPattern[] = [
      new RenamePortPattern(this.workspaceRoot),
      new RenameUseCasePattern(this.workspaceRoot),
      new RenameEntityPattern(this.workspaceRoot),
    ];

    for (const pattern of patterns) {
      this.patterns.set(pattern.name, pattern);
    }
  }

  /**
   * Get all registered pattern names
   */
  getAvailablePatterns(): string[] {
    return Array.from(this.patterns.keys());
  }

  /**
   * Get a specific pattern by name
   */
  getPattern(name: string): RefactoringPattern | undefined {
    return this.patterns.get(name);
  }

  /**
   * Execute a refactoring pattern
   *
   * @param request - The refactoring request
   * @param impact - The impact analysis result
   * @returns Result with files modified and any errors
   */
  async execute(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Promise<Result<RefactoringResult, Error>> {
    // 1. Get the pattern
    const pattern = this.patterns.get(request.type);
    if (!pattern) {
      return err(new Error(`Unknown refactoring pattern: ${request.type}`));
    }

    // 2. Validate the refactoring
    const validationResult = pattern.validate(request, impact);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    // 3. Execute the refactoring
    try {
      const result = await pattern.execute(request, impact);
      return result;
    } catch (error) {
      return err(
        new Error(`Refactoring execution failed: ${(error as Error).message}`),
      );
    }
  }

  /**
   * Validate a refactoring without executing it
   *
   * @param request - The refactoring request
   * @param impact - The impact analysis result
   * @returns Ok if valid, Err with reason if invalid
   */
  validate(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Result<void, Error> {
    const pattern = this.patterns.get(request.type);
    if (!pattern) {
      return err(new Error(`Unknown refactoring pattern: ${request.type}`));
    }

    return pattern.validate(request, impact);
  }
}

// Made with Bob
