// impact-analyzer.ts – Change impact analysis for refactoring operations
// Part of Phase 7: Refactoring Assistant
//
// This module analyzes the impact of proposed refactorings by:
// 1. Finding all references to target symbols using TypeScript AST
// 2. Identifying cross-package dependencies
// 3. Detecting architectural boundary violations
// 4. Estimating the scope of changes required

import { Project, SourceFile, SyntaxKind } from "ts-morph";
import path from "node:path";
import fs from "node:fs";
import { ok, err, type Result } from "../domain/result.js";
import type { Manifest } from "../types/manifest.js";

/**
 * Types of refactoring operations supported
 */
export type RefactoringType =
  | "rename-port"
  | "rename-use-case"
  | "rename-entity"
  | "move-use-case"
  | "extract-port";

/**
 * Request to analyze the impact of a refactoring
 */
export interface ImpactAnalysisRequest {
  type: RefactoringType;
  target: string; // e.g., "UserRepositoryPort"
  newName?: string; // e.g., "UserStorePort" (for renames)
  newLocation?: string; // e.g., "packages/user-store" (for moves)
}

/**
 * Layer classification for files
 */
export type Layer =
  | "domain"
  | "application"
  | "infrastructure"
  | "test"
  | "manifest"
  | "config"
  | "unknown";

/**
 * Information about a file that needs modification
 */
export interface FileToModify {
  path: string;
  reason: string; // e.g., "Imports UserRepositoryPort"
  layer: Layer;
  packageName: string;
}

/**
 * Cross-package dependency information
 */
export interface CrossPackageDependency {
  fromPackage: string;
  toPackage: string;
  symbol: string;
  fromFile: string;
  toFile: string;
}

/**
 * Architectural impact assessment
 */
export type ArchitecturalImpact =
  | "SAFE" // No boundary violations
  | "BOUNDARY_VIOLATION" // Would violate hexagonal boundaries
  | "UNKNOWN"; // Unable to determine

/**
 * Result of impact analysis
 */
export interface ImpactAnalysisResult {
  filesToModify: FileToModify[];
  crossPackageDeps: CrossPackageDependency[];
  architecturalImpact: ArchitecturalImpact;
  estimatedChanges: number;
  warnings: string[];
}

/**
 * Analyzes the impact of proposed refactorings
 */
export class ImpactAnalyzer {
  private project: Project;

  constructor(
    private readonly workspaceRoot: string,
    private readonly manifest: Manifest,
  ) {
    // Initialize ts-morph project for AST analysis
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        target: 99, // ESNext
        module: 99, // ESNext
        moduleResolution: 100, // Bundler
      },
    });
  }

  /**
   * Analyze the impact of a proposed refactoring
   */
  async analyze(
    request: ImpactAnalysisRequest,
  ): Promise<Result<ImpactAnalysisResult, Error>> {
    try {
      // 1. Validate request
      const validationResult = this.validateRequest(request);
      if (!validationResult.success) {
        return err(validationResult.error);
      }

      // 2. Load workspace files
      await this.loadWorkspaceFiles();

      // 3. Find all references to target symbol
      const references = this.findSymbolReferences(request.target);

      // 4. Classify files by layer and package
      const filesToModify = this.classifyFiles(references, request.target);

      // 5. Detect cross-package dependencies
      const crossPackageDeps = this.detectCrossPackageDependencies(
        filesToModify,
        request.target,
      );

      // 6. Assess architectural impact
      const architecturalImpact = this.assessArchitecturalImpact(
        filesToModify,
        crossPackageDeps,
      );

      // 7. Generate warnings
      const warnings = this.generateWarnings(
        request,
        filesToModify,
        crossPackageDeps,
        architecturalImpact,
      );

      // 8. Estimate number of changes
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

  /**
   * Validate the refactoring request
   */
  private validateRequest(request: ImpactAnalysisRequest): Result<void, Error> {
    // Check that target is provided
    if (!request.target || request.target.trim() === "") {
      return err(new Error("Target symbol is required"));
    }

    // Check that newName is provided for rename operations
    if (
      (request.type === "rename-port" ||
        request.type === "rename-use-case" ||
        request.type === "rename-entity") &&
      (!request.newName || request.newName.trim() === "")
    ) {
      return err(new Error("New name is required for rename operations"));
    }

    // Check that newLocation is provided for move operations
    if (
      request.type === "move-use-case" &&
      (!request.newLocation || request.newLocation.trim() === "")
    ) {
      return err(new Error("New location is required for move operations"));
    }

    // Validate naming conventions
    if (request.type === "rename-port" && request.newName) {
      if (!request.newName.endsWith("Port")) {
        return err(new Error("Port names must end with 'Port'"));
      }
      if (!/^[A-Z][a-zA-Z0-9]*Port$/.test(request.newName)) {
        return err(
          new Error("Port names must be in PascalCase and end with 'Port'"),
        );
      }
    }

    if (request.type === "rename-use-case" && request.newName) {
      if (!request.newName.endsWith("UseCase")) {
        return err(new Error("Use case names must end with 'UseCase'"));
      }
      if (!/^[A-Z][a-zA-Z0-9]*UseCase$/.test(request.newName)) {
        return err(
          new Error(
            "Use case names must be in PascalCase and end with 'UseCase'",
          ),
        );
      }
    }

    return ok(undefined);
  }

  /**
   * Load all TypeScript files from the workspace
   */
  private async loadWorkspaceFiles(): Promise<void> {
    const packagesDir = path.join(this.workspaceRoot, "packages");
    const appsDir = path.join(this.workspaceRoot, "apps");

    // Load packages
    if (fs.existsSync(packagesDir)) {
      const packages = fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      for (const pkg of packages) {
        const srcDir = path.join(packagesDir, pkg, "src");
        if (fs.existsSync(srcDir)) {
          this.addSourceFilesRecursively(srcDir);
        }

        const testsDir = path.join(packagesDir, pkg, "__tests__");
        if (fs.existsSync(testsDir)) {
          this.addSourceFilesRecursively(testsDir);
        }
      }
    }

    // Load apps
    if (fs.existsSync(appsDir)) {
      const apps = fs
        .readdirSync(appsDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      for (const app of apps) {
        const srcDir = path.join(appsDir, app, "src");
        if (fs.existsSync(srcDir)) {
          this.addSourceFilesRecursively(srcDir);
        }

        const appDir = path.join(appsDir, app, "app");
        if (fs.existsSync(appDir)) {
          this.addSourceFilesRecursively(appDir);
        }
      }
    }
  }

  /**
   * Recursively add TypeScript source files to the project
   */
  private addSourceFilesRecursively(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules, dist, .next, .turbo
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".next" ||
          entry.name === ".turbo"
        ) {
          continue;
        }
        this.addSourceFilesRecursively(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        // Skip .d.ts files
        if (entry.name.endsWith(".d.ts")) {
          continue;
        }
        this.project.addSourceFileAtPath(fullPath);
      }
    }
  }

  /**
   * Find all references to a symbol in the workspace
   */
  private findSymbolReferences(symbolName: string): SourceFile[] {
    const referencedFiles: SourceFile[] = [];
    const sourceFiles = this.project.getSourceFiles();

    for (const sourceFile of sourceFiles) {
      // Check if file contains the symbol name
      const text = sourceFile.getFullText();
      if (text.includes(symbolName)) {
        referencedFiles.push(sourceFile);
      }
    }

    return referencedFiles;
  }

  /**
   * Classify files by layer and package
   */
  private classifyFiles(
    files: SourceFile[],
    symbolName: string,
  ): FileToModify[] {
    const filesToModify: FileToModify[] = [];

    for (const file of files) {
      const filePath = file.getFilePath();
      const relativePath = path.relative(this.workspaceRoot, filePath);

      // Determine layer
      const layer = this.determineLayer(relativePath);

      // Determine package name
      const packageName = this.determinePackageName(relativePath);

      // Determine reason for modification
      const reason = this.determineModificationReason(file, symbolName);

      filesToModify.push({
        path: relativePath,
        reason,
        layer,
        packageName,
      });
    }

    return filesToModify;
  }

  /**
   * Determine the layer of a file based on its path
   */
  private determineLayer(relativePath: string): Layer {
    if (relativePath.includes("/__tests__/")) {
      return "test";
    }
    if (relativePath.includes("/domain/")) {
      return "domain";
    }
    if (relativePath.includes("/application/")) {
      return "application";
    }
    if (relativePath.includes("/infrastructure/")) {
      return "infrastructure";
    }
    if (relativePath.includes(".architecture/manifest.yaml")) {
      return "manifest";
    }
    if (
      relativePath.includes("tsconfig") ||
      relativePath.includes("package.json")
    ) {
      return "config";
    }
    return "unknown";
  }

  /**
   * Determine the package name from a file path
   */
  private determinePackageName(relativePath: string): string {
    const match = relativePath.match(/^(?:packages|apps)\/([^/]+)/);
    return match ? match[1] : "unknown";
  }

  /**
   * Determine why a file needs to be modified
   */
  private determineModificationReason(
    file: SourceFile,
    symbolName: string,
  ): string {
    // Check for interface/class/type declaration
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

    // Check for imports
    const imports = file.getImportDeclarations();
    for (const importDecl of imports) {
      const namedImports = importDecl.getNamedImports();
      for (const namedImport of namedImports) {
        if (namedImport.getName() === symbolName) {
          return `Imports ${symbolName}`;
        }
      }
    }

    // Check for exports
    const exports = file.getExportDeclarations();
    for (const exportDecl of exports) {
      const namedExports = exportDecl.getNamedExports();
      for (const namedExport of namedExports) {
        if (namedExport.getName() === symbolName) {
          return `Exports ${symbolName}`;
        }
      }
    }

    // Check for type references
    const typeReferences = file.getDescendantsOfKind(SyntaxKind.TypeReference);
    for (const typeRef of typeReferences) {
      if (typeRef.getText().includes(symbolName)) {
        return `References type ${symbolName}`;
      }
    }

    return `Contains reference to ${symbolName}`;
  }

  /**
   * Detect cross-package dependencies
   */
  private detectCrossPackageDependencies(
    files: FileToModify[],
    symbolName: string,
  ): CrossPackageDependency[] {
    const dependencies: CrossPackageDependency[] = [];
    const packageGroups = new Map<string, FileToModify[]>();

    // Group files by package
    for (const file of files) {
      const existing = packageGroups.get(file.packageName) || [];
      existing.push(file);
      packageGroups.set(file.packageName, existing);
    }

    // If symbol is used in multiple packages, it's a cross-package dependency
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

  /**
   * Assess the architectural impact of the refactoring
   */
  private assessArchitecturalImpact(
    files: FileToModify[],
    crossPackageDeps: CrossPackageDependency[],
  ): ArchitecturalImpact {
    // Check for boundary violations
    for (const file of files) {
      // Domain layer should not depend on infrastructure
      if (file.layer === "domain") {
        const domainFile = this.project.getSourceFile(
          path.join(this.workspaceRoot, file.path),
        );
        if (domainFile) {
          const imports = domainFile.getImportDeclarations();
          for (const importDecl of imports) {
            const moduleSpecifier = importDecl.getModuleSpecifierValue();
            if (moduleSpecifier.includes("/infrastructure/")) {
              return "BOUNDARY_VIOLATION";
            }
          }
        }
      }

      // Application layer should not depend on infrastructure (except adapters)
      if (file.layer === "application") {
        const appFile = this.project.getSourceFile(
          path.join(this.workspaceRoot, file.path),
        );
        if (appFile) {
          const imports = appFile.getImportDeclarations();
          for (const importDecl of imports) {
            const moduleSpecifier = importDecl.getModuleSpecifierValue();
            if (
              moduleSpecifier.includes("/infrastructure/") &&
              !moduleSpecifier.includes("/infrastructure/adapters/")
            ) {
              return "BOUNDARY_VIOLATION";
            }
          }
        }
      }
    }

    // Check for cross-package boundary violations
    for (const dep of crossPackageDeps) {
      // Check if dependency is allowed in manifest
      const fromContext = this.manifest.bounded_contexts?.find(
        (c) => c.name === dep.fromPackage,
      );
      const toContext = this.manifest.bounded_contexts?.find(
        (c) => c.name === dep.toPackage,
      );

      if (fromContext && toContext) {
        // Check if dependency is declared in manifest
        const hasDependency = fromContext.depends_on?.some(
          (contextName) => contextName === dep.toPackage,
        );
        if (!hasDependency) {
          return "BOUNDARY_VIOLATION";
        }
      }
    }

    return "SAFE";
  }

  /**
   * Generate warnings about the refactoring
   */
  private generateWarnings(
    request: ImpactAnalysisRequest,
    files: FileToModify[],
    crossPackageDeps: CrossPackageDependency[],
    architecturalImpact: ArchitecturalImpact,
  ): string[] {
    const warnings: string[] = [];

    // Warn about boundary violations
    if (architecturalImpact === "BOUNDARY_VIOLATION") {
      warnings.push(
        "⚠️  This refactoring would violate architectural boundaries",
      );
    }

    // Warn about cross-package dependencies
    if (crossPackageDeps.length > 0) {
      warnings.push(
        `⚠️  This refactoring affects ${crossPackageDeps.length} cross-package dependencies`,
      );
    }

    // Warn about large number of files
    if (files.length > 20) {
      warnings.push(
        `⚠️  This refactoring will modify ${files.length} files (large scope)`,
      );
    }

    // Warn about domain layer changes
    const domainFiles = files.filter((f) => f.layer === "domain");
    if (domainFiles.length > 0) {
      warnings.push(
        `⚠️  This refactoring affects ${domainFiles.length} domain layer files (high risk)`,
      );
    }

    // Warn about test files
    const testFiles = files.filter((f) => f.layer === "test");
    if (testFiles.length > 0) {
      warnings.push(
        `ℹ️  This refactoring will require updating ${testFiles.length} test files`,
      );
    }

    return warnings;
  }

  /**
   * Estimate the number of changes required
   */
  private estimateChanges(files: FileToModify[]): number {
    // Estimate 2-5 changes per file on average
    // - 1 for the declaration/import
    // - 1-2 for type references
    // - 1-2 for usage in code
    return files.length * 3;
  }
}

// Made with Bob
