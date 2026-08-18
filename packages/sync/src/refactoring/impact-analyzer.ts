// impact-analyzer.ts – Change impact analysis for refactoring operations
// Part of Phase 7: Refactoring Assistant
//
// This module has been refactored to use hexagonal architecture:
// - Domain services: impact-request-validator, layer-classifier, architectural-boundary-checker
// - Application ports: workspace-file-provider, symbol-reference-index
// - Application use-cases: refactoring-impact.use-case
// - Infrastructure adapters: file-system-workspace.adapter, ts-morph-symbol-index.adapter

import type { Result } from "../domain/result.js";
import type { Manifest } from "../types/manifest.js";
import type { ImpactAnalysisResult } from "../domain/services/impact-analysis.types.js";
import { FileSystemWorkspaceAdapter } from "../infrastructure/adapters/file-system-workspace.adapter.js";
import { TsMorphSymbolIndexAdapter } from "../infrastructure/adapters/ts-morph-symbol-index.adapter.js";
import { loadLayoutConfig } from "../infrastructure/config/load-layout-config.js";
import { RefactoringImpactUseCase } from "../application/use-cases/refactoring-impact.use-case.js";
import type { ImpactAnalysisRequest } from "../application/use-cases/refactoring-impact.use-case.js";
import type { WorkspaceFileProviderPort } from "../application/ports/out/workspace-file-provider.port.js";

/**
 * Analyzes the impact of proposed refactorings
 *
 * This is the composition root for the impact analyser: it is the only place
 * that names both the workspace adapter and the ts-morph-backed symbol index
 * (HEX-013). The reason ladder that used to live here as
 * `DefaultSymbolReferenceProvider` moved into that adapter unchanged.
 *
 * @deprecated Use RefactoringImpactUseCase directly for new code
 */
export class ImpactAnalyzer {
  private useCase: RefactoringImpactUseCase;
  private fileProvider: WorkspaceFileProviderPort;

  constructor(
    private readonly workspaceRoot: string,
    private readonly manifest: Manifest,
  ) {
    this.fileProvider = new FileSystemWorkspaceAdapter(workspaceRoot);
    const layoutFile = loadLayoutConfig(workspaceRoot);
    this.useCase = new RefactoringImpactUseCase(
      workspaceRoot,
      manifest,
      this.fileProvider,
      new TsMorphSymbolIndexAdapter(),
      layoutFile
        ? { layers: layoutFile.layers, ignore: layoutFile.ignore }
        : undefined,
    );
  }

  async analyze(
    request: ImpactAnalysisRequest,
  ): Promise<Result<ImpactAnalysisResult, Error>> {
    return this.useCase.analyze(request);
  }
}

export type {
  RefactoringType,
  Layer,
  FileToModify,
  CrossPackageDependency,
  ArchitecturalImpact,
  ImpactAnalysisResult,
} from "../domain/services/impact-analysis.types.js";
export type { ImpactAnalysisRequest } from "../application/use-cases/refactoring-impact.use-case.js";
export { validateRequest } from "../domain/services/impact-request-validator.js";
export {
  determineLayer,
  determinePackageName,
} from "../domain/services/layer-classifier.js";
export { assessArchitecturalImpact } from "../domain/services/architectural-boundary-checker.js";
