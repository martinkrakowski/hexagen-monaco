export type RefactoringType =
  | "rename-port"
  | "rename-use-case"
  | "rename-entity"
  | "move-use-case"
  | "extract-port";

export type Layer =
  | "domain"
  | "application"
  | "infrastructure"
  | "test"
  | "manifest"
  | "config"
  | "unknown"
  | "ignored";

export interface FileToModify {
  path: string;
  reason: string;
  layer: Layer;
  packageName: string;
}

export interface CrossPackageDependency {
  fromPackage: string;
  toPackage: string;
  symbol: string;
  fromFile: string;
  toFile: string;
}

export type ArchitecturalImpact = "SAFE" | "BOUNDARY_VIOLATION" | "UNKNOWN";

export interface ImpactAnalysisResult {
  filesToModify: FileToModify[];
  crossPackageDeps: CrossPackageDependency[];
  architecturalImpact: ArchitecturalImpact;
  estimatedChanges: number;
  warnings: string[];
}
