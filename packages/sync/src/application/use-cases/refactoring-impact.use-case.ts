import { ok, err, type Result } from "../../domain/result.js";
import type { Manifest } from "../../types/manifest.js";
import type { WorkspaceFileProviderPort } from "../ports/out/workspace-file-provider.port.js";
import type {
  SymbolReferenceDto,
  SymbolReferenceIndexPort,
} from "../ports/out/symbol-reference-index.port.js";
import { validateRequest } from "../../domain/services/impact-request-validator.js";
import {
  determineLayer,
  determinePackageName,
  toWorkspaceRelativePosixPath,
  type LayoutConfig,
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
 * Analyses what a proposed refactoring would touch.
 *
 * The TypeScript parser sits behind `SymbolReferenceIndexPort` (HEX-013, item
 * 5.7): this use case no longer constructs a ts-morph `Project` and no AST node
 * ever reaches it. What crosses the boundary is `SymbolReferenceDto` — a file
 * path and a reason sentence — from which every downstream step
 * (classification, cross-package detection, boundary assessment, warnings) is
 * derived by string work alone. Enumerating which files to hand the index
 * stays here, because that is exactly such string work and it is where the
 * exclusions (`node_modules`, build output, `.d.ts`) are decided.
 */
export class RefactoringImpactUseCase {
  constructor(
    private readonly workspaceRoot: string,
    private readonly manifest: Manifest,
    private readonly fileProvider: WorkspaceFileProviderPort,
    private readonly symbolIndex: SymbolReferenceIndexPort,
    private readonly layoutConfig?: LayoutConfig,
  ) {}

  async analyze(
    request: ImpactAnalysisRequest,
  ): Promise<Result<ImpactAnalysisResult, Error>> {
    try {
      const validation = validateRequest(request);
      if (!validation.valid) {
        return err(new Error(validation.error));
      }

      await this.loadWorkspaceFiles();

      const references = this.symbolIndex.findReferences(request.target);

      const filesToModify = this.classifyFiles(references);

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

    const filePaths: string[] = [];

    for (const pkg of packages) {
      const srcDir = `${this.workspaceRoot}/packages/${pkg}/src`;
      if (this.fileProvider.fileExists(srcDir)) {
        this.collectSourceFilesRecursively(srcDir, filePaths);
      }

      const testsDir = `${this.workspaceRoot}/packages/${pkg}/__tests__`;
      if (this.fileProvider.fileExists(testsDir)) {
        this.collectSourceFilesRecursively(testsDir, filePaths);
      }
    }

    for (const app of apps) {
      const srcDir = `${this.workspaceRoot}/apps/${app}/src`;
      if (this.fileProvider.fileExists(srcDir)) {
        this.collectSourceFilesRecursively(srcDir, filePaths);
      }

      const appDir = `${this.workspaceRoot}/apps/${app}/app`;
      if (this.fileProvider.fileExists(appDir)) {
        this.collectSourceFilesRecursively(appDir, filePaths);
      }
    }

    this.symbolIndex.indexFiles(filePaths);
  }

  /**
   * Which files are worth parsing at all. Pure string work on paths the
   * workspace provider reported, so it belongs on this side of the port: the
   * exclusions (vendored trees, build output, ambient declarations) are an
   * analyser policy, not a parser capability.
   */
  private collectSourceFilesRecursively(dir: string, into: string[]): void {
    const entries = this.fileProvider.getSourceFiles(dir);

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (
          !entry.path.includes("node_modules") &&
          !entry.path.includes("dist") &&
          !entry.path.includes(".next") &&
          !entry.path.includes(".turbo")
        ) {
          this.collectSourceFilesRecursively(entry.path, into);
        }
      } else if (entry.path.endsWith(".ts") || entry.path.endsWith(".tsx")) {
        if (!entry.path.endsWith(".d.ts")) {
          into.push(entry.path);
        }
      }
    }
  }

  private classifyFiles(
    references: readonly SymbolReferenceDto[],
  ): FileToModify[] {
    return references.map((reference) => {
      const relativePath = toWorkspaceRelativePosixPath(
        this.workspaceRoot,
        reference.filePath,
      );

      return {
        path: relativePath,
        reason: reference.reason,
        layer: determineLayer(relativePath, this.layoutConfig),
        packageName: determinePackageName(relativePath),
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
