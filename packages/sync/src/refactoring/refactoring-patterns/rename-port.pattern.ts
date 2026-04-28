// rename-port.pattern.ts – Rename port interface refactoring pattern
// Part of Phase 7: Refactoring Assistant
//
// This pattern renames a port interface and updates all references:
// 1. Renames the port interface file and declaration
// 2. Updates all import statements
// 3. Updates barrel exports (index.ts files)
// 4. Updates manifest.yaml
// 5. Updates test doubles
// 6. Updates MCP tool registrations

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
 * Pattern for renaming port interfaces
 */
export class RenamePortPattern implements RefactoringPattern {
  name = "rename-port";
  description = "Rename a port interface and update all references";

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
    // Check that target is a port (ends with "Port")
    if (!request.target.endsWith("Port")) {
      return err(
        new Error(
          `Target "${request.target}" is not a port (must end with "Port")`,
        ),
      );
    }

    // Check that newName is valid (PascalCase, ends with "Port")
    if (!request.newName) {
      return err(new Error("New name is required for rename operations"));
    }

    if (!request.newName.endsWith("Port")) {
      return err(
        new Error(
          `New name "${request.newName}" is not a port (must end with "Port")`,
        ),
      );
    }

    if (!/^[A-Z][a-zA-Z0-9]*Port$/.test(request.newName)) {
      return err(
        new Error(
          `New name "${request.newName}" must be in PascalCase and end with "Port"`,
        ),
      );
    }

    // Check for boundary violations
    if (impact.architecturalImpact === "BOUNDARY_VIOLATION") {
      return err(
        new Error("Refactoring would violate architectural boundaries"),
      );
    }

    // Check that newName doesn't already exist
    const portFiles = impact.filesToModify.filter((f) =>
      f.reason.includes("Declares"),
    );
    for (const file of portFiles) {
      const filePath = path.join(this.workspaceRoot, file.path);
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const existingInterface = sourceFile.getInterface(request.newName);
      if (existingInterface) {
        return err(
          new Error(
            `Interface "${request.newName}" already exists in ${file.path}`,
          ),
        );
      }
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
      // 1. Load all affected files into ts-morph project
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

      // 2. Rename port interface file and declaration
      const portFiles = impact.filesToModify.filter(
        (f) =>
          f.reason.includes("Declares interface") ||
          f.reason.includes("Declares type"),
      );
      for (const file of portFiles) {
        const result = await this.renamePortFile(
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

      // 3. Update all import statements
      const importFiles = impact.filesToModify.filter((f) =>
        f.reason.includes("Imports"),
      );
      for (const file of importFiles) {
        const result = await this.updateImports(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success) {
          if (result.value.length > 0) {
            filesModified.push(...result.value);
          }
        } else {
          errors.push(result.error);
        }
      }

      // 4. Update barrel exports
      const barrelFiles = impact.filesToModify.filter((f) =>
        f.path.endsWith("index.ts"),
      );
      for (const file of barrelFiles) {
        const result = await this.updateBarrelExport(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success) {
          if (result.value.length > 0) {
            filesModified.push(...result.value);
          }
        } else {
          errors.push(result.error);
        }
      }

      // 5. Update manifest.yaml
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

      // 6. Update test doubles
      const testFiles = impact.filesToModify.filter((f) => f.layer === "test");
      for (const file of testFiles) {
        const result = await this.updateTestDouble(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success) {
          if (result.value.length > 0) {
            filesModified.push(...result.value);
          }
        } else {
          errors.push(result.error);
        }
      }

      // 7. Save all modified files
      await this.project.save();

      return ok({
        success: errors.length === 0,
        filesModified: Array.from(new Set(filesModified)), // Remove duplicates
        errors,
        warnings,
      });
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Rename port interface file and declaration
   */
  private async renamePortFile(
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

      // Find and rename the interface
      const interfaceDecl = sourceFile.getInterface(oldName);
      if (interfaceDecl) {
        interfaceDecl.rename(newName);
      }

      // Find and rename type alias if it exists
      const typeAlias = sourceFile.getTypeAlias(oldName);
      if (typeAlias) {
        typeAlias.rename(newName);
      }

      // Rename the file itself
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
        return ok([]); // File might not be TypeScript
      }

      let modified = false;

      // Update named imports
      const imports = sourceFile.getImportDeclarations();
      for (const importDecl of imports) {
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of namedImports) {
          if (namedImport.getName() === oldName) {
            namedImport.setName(newName);
            modified = true;
          }
        }

        // Update module specifier if it references the old file name
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

      // Update export declarations
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

      // Update port declarations in bounded contexts
      if (manifest.bounded_contexts) {
        for (const context of manifest.bounded_contexts) {
          if (context.layers?.application?.ports?.out) {
            const index = context.layers.application.ports.out.indexOf(oldName);
            if (index !== -1) {
              context.layers.application.ports.out[index] = newName;
            }
          }
          if (context.layers?.domain?.ports?.out) {
            const index = context.layers.domain.ports.out.indexOf(oldName);
            if (index !== -1) {
              context.layers.domain.ports.out[index] = newName;
            }
          }
        }
      }

      // Write updated manifest
      const updatedContent = yaml.dump(manifest, { indent: 2 });
      await fs.writeFile(manifestPath, updatedContent, "utf-8");

      return ok(undefined);
    } catch (error) {
      return err(error as Error);
    }
  }

  /**
   * Update test double
   */
  private async updateTestDouble(
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

      // Find and rename the fake class
      const oldFakeName = oldName.replace(/Port$/, "Fake");
      const newFakeName = newName.replace(/Port$/, "Fake");

      const classes = sourceFile.getClasses();
      for (const cls of classes) {
        if (cls.getName() === oldFakeName) {
          cls.rename(newFakeName);
          modified = true;
        }

        // Update implements clause
        const implementsClauses = cls.getImplements();
        for (const implementsClause of implementsClauses) {
          if (implementsClause.getText().includes(oldName)) {
            const newText = implementsClause
              .getText()
              .replace(oldName, newName);
            implementsClause.replaceWithText(newText);
            modified = true;
          }
        }
      }

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

      // Rename the file itself if needed
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
