// base-pattern.ts – Base interface for refactoring patterns
// Part of Phase 7: Refactoring Assistant

import type { Result } from "../../domain/result.js";
import type {
  ImpactAnalysisRequest,
  ImpactAnalysisResult,
} from "../impact-analyzer.js";

/**
 * Result of executing a refactoring pattern
 */
export interface RefactoringResult {
  success: boolean;
  filesModified: string[];
  errors: Error[];
  warnings: string[];
}

/**
 * Base interface for all refactoring patterns
 */
export interface RefactoringPattern {
  /** Pattern identifier */
  name: string;

  /** Human-readable description */
  description: string;

  /**
   * Validate that the refactoring is safe to execute
   *
   * @param request - The refactoring request
   * @param impact - The impact analysis result
   * @returns Ok if valid, Err with reason if invalid
   */
  validate(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Result<void, Error>;

  /**
   * Execute the refactoring by applying AST transformations
   *
   * @param request - The refactoring request
   * @param impact - The impact analysis result
   * @returns Result with files modified and any errors
   */
  execute(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Promise<Result<RefactoringResult, Error>>;
}

// Made with Bob
