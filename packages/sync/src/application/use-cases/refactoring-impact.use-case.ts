import { Project, SourceFile, SyntaxKind } from "ts-morph";
import { ok, err, type Result } from "../../domain/result.js";
import type { Manifest } from "../../types/manifest.js";
import type { WorkspaceFileProviderPort } from "../ports/out/workspace-file-provider.port.js";
import type { SymbolReferenceProviderPort } from "../ports/out/symbol-reference-provider.port.js";
import { validateRequest } from "../../domain/services/impact-request-validator.js";
import {
  determineLayer,
  determinePackageName,
} from "../../domain/services/layer-classifier.js";
import { assessArchitecturalImpact } from "../../domain/services/architectural-boundary-checker.js";
import type {
  RefactoringType,
  Layer,
  FileToModify,
  CrossPackageDependency,
  ArchitecturalImpact,
  ImpactAnalysisResult,
} from "../../domain/services/impact-analysis.types.js";

export interface ImpactAnalysisRequest {
  type: RefactoringType;
  target: string;
  newName?: string;
  newLocation?: string;
}

/**
 * The ts-morph project settings this analyser parses consumer workspaces with.
 *
 * Exported so the parser contract can be pinned by a test against the *same*
 * object production uses, rather than a copy that silently drifts. See
 * `__tests__/refactoring/modern-typescript-syntax.test.ts` (AUD-012): the
 * engine is published and points at arbitrary user code, so the TypeScript
 * version ts-morph bundles has to be at least as new as the one this repo
 * compiles with — ts-morph 22 bundled TS 5.4.2 and could not parse TS 5.9
 * syntax at all.
 */
export const REFACTORING_IMPACT_COMPILER_OPTIONS = {
  skipAddingFilesFromTsConfig: true,
  compilerOptions: {
    target: 99,
    module: 99,
    moduleResolution: 100,
  },
} as const;

export class RefactoringImpactUseCase {
  private project: Project;

  constructor(
    private readonly workspaceRoot: string,
    private readonly manifest: Manifest,
    private readonly fileProvider: WorkspaceFileProviderPort,
    private readonly symbolProvider: SymbolReferenceProviderPort,
  ) {
    this.project = new Project({ ...REFACTORING_IMPACT_COMPILER_OPTIONS });
  }

  async analyze(
    request: ImpactAnalysisRequest,
  ): Promise<Result<ImpactAnalysisResult, Error>> {
    try {
      const validation = validateRequest(request);
      if (!validation.valid) {
        return err(new Error(validation.error));
      }

      await this.loadWorkspaceFiles();

      const references = this.findSymbolReferences(request.target);

      const filesToModify = this.classifyFiles(references, request.target);

      const crossPackageDeps = this.detectCrossPackageDependencies(
        filesToModify,
        request.target,
      );

      const architecturalImpact = this.assessImpact(
        filesToModify,
        crossPackageDeps,
      );

      const warnings = this.generateWarnings(
        filesToModify,
        crossPackageDeps,
        architecturalImpact,
      );

      const estimatedChanges = this.estimateChanges(filesToModify);

      return ok({
        filesToModify,
        crossPackageDeps,
        architecturalImpact,
        estimatedChanges,
        warnings,
      });
    } catch (error) {
      return err(error as Error);
    }
  }

  private async loadWorkspaceFiles(): Promise<void> {
    const packages = this.fileProvider.listPackages();
    const apps = this.fileProvider.listApps();

    for (const pkg of packages) {
      const srcDir = `${this.workspaceRoot}/packages/${pkg}/src`;
      if (this.fileProvider.fileExists(srcDir)) {
        this.addSourceFilesRecursively(srcDir);
      }

      const testsDir = `${this.workspaceRoot}/packages/${pkg}/__tests__`;
      if (this.fileProvider.fileExists(testsDir)) {
        this.addSourceFilesRecursively(testsDir);
      }
    }

    for (const app of apps) {
      const srcDir = `${this.workspaceRoot}/apps/${app}/src`;
      if (this.fileProvider.fileExists(srcDir)) {
        this.addSourceFilesRecursively(srcDir);
      }

      const appDir = `${this.workspaceRoot}/apps/${app}/app`;
      if (this.fileProvider.fileExists(appDir)) {
        this.addSourceFilesRecursively(appDir);
      }
    }
  }

  private addSourceFilesRecursively(dir: string): void {
    const entries = this.fileProvider.getSourceFiles(dir);

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (
          !entry.path.includes("node_modules") &&
          !entry.path.includes("dist") &&
          !entry.path.includes(".next") &&
          !entry.path.includes(".turbo")
        ) {
          this.addSourceFilesRecursively(entry.path);
        }
      } else if (entry.path.endsWith(".ts") || entry.path.endsWith(".tsx")) {
        if (!entry.path.endsWith(".d.ts")) {
          this.project.addSourceFileAtPath(entry.path);
        }
      }
    }
  }

  private findSymbolReferences(symbolName: string): SourceFile[] {
    const sourceFiles = this.project.getSourceFiles();
    return sourceFiles.filter((sf) => sf.getFullText().includes(symbolName));
  }

  private classifyFiles(
    files: SourceFile[],
    symbolName: string,
  ): FileToModify[] {
    return files.map((file) => {
      const filePath = file.getFilePath();
      const relativePath = filePath.replace(`${this.workspaceRoot}/`, "");
      const layer = determineLayer(relativePath);
      const packageName = determinePackageName(relativePath);
      const reason = this.symbolProvider.getModificationReason(
        file,
        symbolName,
      );

      return {
        path: relativePath,
        reason,
        layer,
        packageName,
      };
    });
  }

  private detectCrossPackageDependencies(
    files: FileToModify[],
    symbolName: string,
  ): CrossPackageDependency[] {
    const dependencies: CrossPackageDependency[] = [];
    const packageGroups = new Map<string, FileToModify[]>();

    for (const file of files) {
      const existing = packageGroups.get(file.packageName) || [];
      existing.push(file);
      packageGroups.set(file.packageName, existing);
    }

    if (packageGroups.size > 1) {
      const packages = Array.from(packageGroups.keys());
      for (let i = 0; i < packages.length; i++) {
        for (let j = i + 1; j < packages.length; j++) {
          const fromPackage = packages[i];
          const toPackage = packages[j];
          const fromFiles = packageGroups.get(fromPackage) || [];
          const toFiles = packageGroups.get(toPackage) || [];

          if (fromFiles.length > 0 && toFiles.length > 0) {
            dependencies.push({
              fromPackage,
              toPackage,
              symbol: symbolName,
              fromFile: fromFiles[0].path,
              toFile: toFiles[0].path,
            });
          }
        }
      }
    }

    return dependencies;
  }

  private assessImpact(
    files: FileToModify[],
    crossPackageDeps: CrossPackageDependency[],
  ): ArchitecturalImpact {
    return assessArchitecturalImpact(files, crossPackageDeps, this.manifest);
  }

  private generateWarnings(
    files: FileToModify[],
    crossPackageDeps: CrossPackageDependency[],
    architecturalImpact: ArchitecturalImpact,
  ): string[] {
    const warnings: string[] = [];

    if (architecturalImpact === "BOUNDARY_VIOLATION") {
      warnings.push("This refactoring would violate architectural boundaries");
    }

    if (crossPackageDeps.length > 0) {
      warnings.push(
        `This refactoring affects ${crossPackageDeps.length} cross-package dependencies`,
      );
    }

    if (files.length > 20) {
      warnings.push(
        `This refactoring will modify ${files.length} files (large scope)`,
      );
    }

    const domainFiles = files.filter((f) => f.layer === "domain");
    if (domainFiles.length > 0) {
      warnings.push(
        `This refactoring affects ${domainFiles.length} domain layer files (high risk)`,
      );
    }

    const testFiles = files.filter((f) => f.layer === "test");
    if (testFiles.length > 0) {
      warnings.push(
        `This refactoring will require updating ${testFiles.length} test files`,
      );
    }

    return warnings;
  }

  private estimateChanges(files: FileToModify[]): number {
    return files.length * 3;
  }
}
