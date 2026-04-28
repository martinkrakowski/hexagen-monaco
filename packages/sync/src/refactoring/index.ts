// refactoring/index.ts – Public API for refactoring assistant
// Part of Phase 7: Refactoring Assistant

export {
  ImpactAnalyzer,
  type ImpactAnalysisRequest,
  type ImpactAnalysisResult,
  type FileToModify,
  type CrossPackageDependency,
  type ArchitecturalImpact,
  type RefactoringType,
  type Layer,
} from "./impact-analyzer.js";

export { RefactoringEngine } from "./refactoring-engine.js";

export {
  SafeRefactoringOrchestrator,
  type SafeRefactoringConfig,
  type ValidationResult,
  type SafeRefactoringResult,
} from "./safe-refactoring-orchestrator.js";

export type {
  RefactoringPattern,
  RefactoringResult,
} from "./refactoring-patterns/index.js";

export {
  RenamePortPattern,
  RenameUseCasePattern,
  RenameEntityPattern,
} from "./refactoring-patterns/index.js";

// Made with Bob
