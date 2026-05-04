// impact-analyzer.ts – Change impact analysis for refactoring operations
// Part of Phase 7: Refactoring Assistant
//
// This module has been refactored to use hexagonal architecture:
// - Domain services: impact-request-validator, layer-classifier, architectural-boundary-checker
// - Application ports: workspace-file-provider, symbol-reference-provider
// - Application use-cases: refactoring-impact.use-case
// - Infrastructure adapters: file-system-workspace.adapter

import type { Result } from "../domain/result.js";
import type { Manifest } from "../types/manifest.js";
import type { ImpactAnalysisResult } from "../domain/services/impact-analysis.types.js";
import { FileSystemWorkspaceAdapter } from "../infrastructure/adapters/file-system-workspace.adapter.js";
import { RefactoringImpactUseCase } from "../application/use-cases/refactoring-impact.use-case.js";
import type { ImpactAnalysisRequest } from "../application/use-cases/refactoring-impact.use-case.js";
import type { WorkspaceFileProviderPort } from "../application/ports/out/workspace-file-provider.port.js";
import type { SymbolReferenceProviderPort } from "../application/ports/out/symbol-reference-provider.port.js";
import { SourceFile, SyntaxKind } from "ts-morph";

/**
 * Analyzes the impact of proposed refactorings
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
    const symbolProvider = new DefaultSymbolReferenceProvider();
    this.useCase = new RefactoringImpactUseCase(
      workspaceRoot,
      manifest,
      this.fileProvider,
      symbolProvider,
    );
  }

  async analyze(
    request: ImpactAnalysisRequest,
  ): Promise<Result<ImpactAnalysisResult, Error>> {
    return this.useCase.analyze(request);
  }
}

class DefaultSymbolReferenceProvider implements SymbolReferenceProviderPort {
  findReferences(symbolName: string, sourceFiles: SourceFile[]): { sourceFile: SourceFile; reason: string }[] {
    return sourceFiles
      .filter((sf) => sf.getFullText().includes(symbolName))
      .map((sf) => ({
        sourceFile: sf,
        reason: `Contains reference to ${symbolName}`,
      }));
  }

  getModificationReason(file: SourceFile, symbolName: string): string {
    const interfaces = file.getInterfaces();
    for (const iface of interfaces) {
      if (iface.getName() === symbolName) {
        return `Declares interface ${symbolName}`;
      }
    }

    const classes = file.getClasses();
    for (const cls of classes) {
      if (cls.getName() === symbolName) {
        return `Declares class ${symbolName}`;
      }
    }

    const typeAliases = file.getTypeAliases();
    for (const typeAlias of typeAliases) {
      if (typeAlias.getName() === symbolName) {
        return `Declares type ${symbolName}`;
      }
    }

    const imports = file.getImportDeclarations();
    for (const importDecl of imports) {
      const namedImports = importDecl.getNamedImports();
      for (const namedImport of namedImports) {
        if (namedImport.getName() === symbolName) {
          return `Imports ${symbolName}`;
        }
      }
    }

    const exports = file.getExportDeclarations();
    for (const exportDecl of exports) {
      const namedExports = exportDecl.getNamedExports();
      for (const namedExport of namedExports) {
        if (namedExport.getName() === symbolName) {
          return `Exports ${symbolName}`;
        }
      }
    }

    const typeReferences = file.getDescendantsOfKind(SyntaxKind.TypeReference);
    for (const typeRef of typeReferences) {
      if (typeRef.getText().includes(symbolName)) {
        return `References type ${symbolName}`;
      }
    }

    return `Contains reference to ${symbolName}`;
  }
}

export type { RefactoringType, Layer, FileToModify, CrossPackageDependency, ArchitecturalImpact, ImpactAnalysisResult } from "../domain/services/impact-analysis.types.js";
export type { ImpactAnalysisRequest } from "../application/use-cases/refactoring-impact.use-case.js";
export { validateRequest } from "../domain/services/impact-request-validator.js";
export { determineLayer, determinePackageName } from "../domain/services/layer-classifier.js";
export { assessArchitecturalImpact } from "../domain/services/architectural-boundary-checker.js";