// rename-use-case.pattern.ts – Rename use case refactoring pattern
// Part of Phase 7: Refactoring Assistant
//
// This pattern renames a use case and updates all references:
// 1. Renames the use case class file and declaration
// 2. Updates all import statements
// 3. Updates barrel exports (index.ts files)
// 4. Updates manifest.yaml
// 5. Updates test files
// 6. Updates composition root (wire.server.ts)
// 7. Updates MCP tool registrations

import { Project } from "ts-morph";
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { ok, err, type Result } from "../../domain/result.js";
import type {
  ImpactAnalysisRequest,
  ImpactAnalysisResult,
} from "../impact-analyzer.js";
import type { RefactoringPattern, RefactoringResult } from "./base-pattern.js";
import type { Manifest } from "../../types/manifest.js";

/**
 * Pattern for renaming use cases
 */
export class RenameUseCasePattern implements RefactoringPattern {
  name = "rename-use-case";
  description = "Rename a use case and update all references";

  private project: Project;

  constructor(private readonly workspaceRoot: string) {
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
   * Validate that the refactoring is safe to execute
   */
  validate(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Result<void, Error> {
    // Check that target is a use case (ends with "UseCase")
    if (!request.target.endsWith("UseCase")) {
      return err(
        new Error(
          `Target "${request.target}" is not a use case (must end with "UseCase")`,
        ),
      );
    }

    // Check that newName is valid (PascalCase, ends with "UseCase")
    if (!request.newName) {
      return err(new Error("New name is required for rename operations"));
    }

    if (!request.newName.endsWith("UseCase")) {
      return err(
        new Error(
          `New name "${request.newName}" is not a use case (must end with "UseCase")`,
        ),
      );
    }

    if (!/^[A-Z][a-zA-Z0-9]*UseCase$/.test(request.newName)) {
      return err(
        new Error(
          `New name "${request.newName}" must be in PascalCase and end with "UseCase"`,
        ),
      );
    }

    // Check for boundary violations
    if (impact.architecturalImpact === "BOUNDARY_VIOLATION") {
      return err(
        new Error("Refactoring would violate architectural boundaries"),
      );
    }

    return ok(undefined);
  }

  /**
   * Execute the refactoring
   */
  async execute(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Promise<Result<RefactoringResult, Error>> {
    const filesModified: string[] = [];
    const errors: Error[] = [];
    const warnings: string[] = [];

    try {
      // Load all affected files
      for (const file of impact.filesToModify) {
        const filePath = path.join(this.workspaceRoot, file.path);
        if (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) {
          try {
            this.project.addSourceFileAtPath(filePath);
          } catch {
            // File might already be added
          }
        }
      }

      // 1. Rename use case file and class
      const useCaseFiles = impact.filesToModify.filter(
        (f) =>
          f.reason.includes("Declares class") && f.path.includes("use-cases"),
      );
      for (const file of useCaseFiles) {
        const result = await this.renameUseCaseFile(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success) {
          filesModified.push(...result.value);
        } else {
          errors.push(result.error);
        }
      }

      // 2. Update imports
      const importFiles = impact.filesToModify.filter((f) =>
        f.reason.includes("Imports"),
      );
      for (const file of importFiles) {
        const result = await this.updateImports(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success && result.value.length > 0) {
          filesModified.push(...result.value);
        } else if (!result.success) {
          errors.push(result.error);
        }
      }

      // 3. Update barrel exports
      const barrelFiles = impact.filesToModify.filter((f) =>
        f.path.endsWith("index.ts"),
      );
      for (const file of barrelFiles) {
        const result = await this.updateBarrelExport(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success && result.value.length > 0) {
          filesModified.push(...result.value);
        } else if (!result.success) {
          errors.push(result.error);
        }
      }

      // 4. Update manifest.yaml
      const manifestFiles = impact.filesToModify.filter(
        (f) => f.layer === "manifest",
      );
      if (manifestFiles.length > 0) {
        const result = await this.updateManifest(
          request.target,
          request.newName!,
        );
        if (result.success) {
          filesModified.push(".architecture/manifest.yaml");
        } else {
          errors.push(result.error);
        }
      }

      // 5. Update test files
      const testFiles = impact.filesToModify.filter((f) => f.layer === "test");
      for (const file of testFiles) {
        const result = await this.updateTestFile(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success && result.value.length > 0) {
          filesModified.push(...result.value);
        } else if (!result.success) {
          errors.push(result.error);
        }
      }

      // 6. Update composition root
      const wireFiles = impact.filesToModify.filter((f) =>
        f.path.includes("wire.server.ts"),
      );
      for (const file of wireFiles) {
        const result = await this.updateCompositionRoot(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success && result.value.length > 0) {
          filesModified.push(...result.value);
        } else if (!result.success) {
          errors.push(result.error);
        }
      }

      // Save all changes
      await this.project.save();

      return ok({
        success: errors.length === 0,
        filesModified: Array.from(new Set(filesModified)),
        errors,
        warnings,
      });
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Rename use case file and class
   */
  private async renameUseCaseFile(
    relativePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<string[], Error>> {
    try {
      const filePath = path.join(this.workspaceRoot, relativePath);
      const sourceFile = this.project.getSourceFile(filePath);

      if (!sourceFile) {
        return err(new Error(`Source file not found: ${relativePath}`));
      }

      // Rename the class
      const classDecl = sourceFile.getClass(oldName);
      if (classDecl) {
        classDecl.rename(newName);
      }

      // Rename the file
      const oldFileName = path.basename(relativePath);
      const newFileName = oldFileName.replace(
        this.toKebabCase(oldName),
        this.toKebabCase(newName),
      );

      if (oldFileName !== newFileName) {
        const newFilePath = path.join(path.dirname(filePath), newFileName);
        await sourceFile.move(newFilePath);
        return ok([
          relativePath,
          path.relative(this.workspaceRoot, newFilePath),
        ]);
      }

      return ok([relativePath]);
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Update import statements
   */
  private async updateImports(
    relativePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<string[], Error>> {
    try {
      const filePath = path.join(this.workspaceRoot, relativePath);
      const sourceFile = this.project.getSourceFile(filePath);

      if (!sourceFile) {
        return ok([]);
      }

      let modified = false;

      const imports = sourceFile.getImportDeclarations();
      for (const importDecl of imports) {
        // Update named imports
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of namedImports) {
          if (namedImport.getName() === oldName) {
            namedImport.setName(newName);
            modified = true;
          }
        }

        // Update module specifier
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const oldKebab = this.toKebabCase(oldName);
        const newKebab = this.toKebabCase(newName);
        if (moduleSpecifier.includes(oldKebab)) {
          const newModuleSpecifier = moduleSpecifier.replace(
            oldKebab,
            newKebab,
          );
          importDecl.setModuleSpecifier(newModuleSpecifier);
          modified = true;
        }
      }

      return ok(modified ? [relativePath] : []);
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Update barrel export
   */
  private async updateBarrelExport(
    relativePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<string[], Error>> {
    try {
      const filePath = path.join(this.workspaceRoot, relativePath);
      const sourceFile = this.project.getSourceFile(filePath);

      if (!sourceFile) {
        return ok([]);
      }

      let modified = false;

      const exports = sourceFile.getExportDeclarations();
      for (const exportDecl of exports) {
        // Update module specifier
        const moduleSpecifier = exportDecl.getModuleSpecifierValue();
        if (moduleSpecifier) {
          const oldKebab = this.toKebabCase(oldName);
          const newKebab = this.toKebabCase(newName);
          if (moduleSpecifier.includes(oldKebab)) {
            const newModuleSpecifier = moduleSpecifier.replace(
              oldKebab,
              newKebab,
            );
            exportDecl.setModuleSpecifier(newModuleSpecifier);
            modified = true;
          }
        }

        // Update named exports
        const namedExports = exportDecl.getNamedExports();
        for (const namedExport of namedExports) {
          if (namedExport.getName() === oldName) {
            namedExport.setName(newName);
            modified = true;
          }
        }
      }

      return ok(modified ? [relativePath] : []);
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Update manifest.yaml
   */
  private async updateManifest(
    oldName: string,
    newName: string,
  ): Promise<Result<void, Error>> {
    try {
      const manifestPath = path.join(
        this.workspaceRoot,
        ".architecture/manifest.yaml",
      );
      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.load(content) as Manifest;

      // Update use case declarations
      if (manifest.bounded_contexts) {
        for (const context of manifest.bounded_contexts) {
          if (context.layers?.application?.use_cases) {
            const index = context.layers.application.use_cases.indexOf(oldName);
            if (index !== -1) {
              context.layers.application.use_cases[index] = newName;
            }
          }
        }
      }

      const updatedContent = yaml.dump(manifest, { indent: 2 });
      await fs.writeFile(manifestPath, updatedContent, "utf-8");

      return ok(undefined);
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Update test file
   */
  private async updateTestFile(
    relativePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<string[], Error>> {
    try {
      const filePath = path.join(this.workspaceRoot, relativePath);
      const sourceFile = this.project.getSourceFile(filePath);

      if (!sourceFile) {
        return ok([]);
      }

      let modified = false;

      // Update imports
      const imports = sourceFile.getImportDeclarations();
      for (const importDecl of imports) {
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of namedImports) {
          if (namedImport.getName() === oldName) {
            namedImport.setName(newName);
            modified = true;
          }
        }

        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const oldKebab = this.toKebabCase(oldName);
        const newKebab = this.toKebabCase(newName);
        if (moduleSpecifier.includes(oldKebab)) {
          const newModuleSpecifier = moduleSpecifier.replace(
            oldKebab,
            newKebab,
          );
          importDecl.setModuleSpecifier(newModuleSpecifier);
          modified = true;
        }
      }

      // Rename test file if needed
      if (modified) {
        const oldFileName = path.basename(relativePath);
        const newFileName = oldFileName.replace(
          this.toKebabCase(oldName),
          this.toKebabCase(newName),
        );

        if (oldFileName !== newFileName) {
          const newFilePath = path.join(path.dirname(filePath), newFileName);
          await sourceFile.move(newFilePath);
          return ok([
            relativePath,
            path.relative(this.workspaceRoot, newFilePath),
          ]);
        }
      }

      return ok(modified ? [relativePath] : []);
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Update composition root (wire.server.ts)
   */
  private async updateCompositionRoot(
    relativePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<string[], Error>> {
    try {
      const filePath = path.join(this.workspaceRoot, relativePath);
      const sourceFile = this.project.getSourceFile(filePath);

      if (!sourceFile) {
        return ok([]);
      }

      let modified = false;

      // Update imports
      const imports = sourceFile.getImportDeclarations();
      for (const importDecl of imports) {
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of namedImports) {
          if (namedImport.getName() === oldName) {
            namedImport.setName(newName);
            modified = true;
          }
        }

        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const oldKebab = this.toKebabCase(oldName);
        const newKebab = this.toKebabCase(newName);
        if (moduleSpecifier.includes(oldKebab)) {
          const newModuleSpecifier = moduleSpecifier.replace(
            oldKebab,
            newKebab,
          );
          importDecl.setModuleSpecifier(newModuleSpecifier);
          modified = true;
        }
      }

      // Update variable declarations and function names
      const oldGetterName = `get${oldName}`;
      const newGetterName = `get${newName}`;

      const functions = sourceFile.getFunctions();
      for (const func of functions) {
        if (func.getName() === oldGetterName) {
          func.rename(newGetterName);
          modified = true;
        }
      }

      const variables = sourceFile.getVariableDeclarations();
      for (const variable of variables) {
        const varName = variable.getName();
        if (varName.includes(oldName)) {
          const newVarName = varName.replace(oldName, newName);
          variable.rename(newVarName);
          modified = true;
        }
      }

      return ok(modified ? [relativePath] : []);
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Convert PascalCase to kebab-case
   */
  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .toLowerCase();
  }
}

// Made with Bob
