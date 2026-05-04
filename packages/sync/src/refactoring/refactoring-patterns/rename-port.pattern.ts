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
import { ok, err, type Result } from "../../domain/result.js";
import type {
  ImpactAnalysisRequest,
  ImpactAnalysisResult,
} from "../impact-analyzer.js";
import type { RefactoringPattern, RefactoringResult } from "./base-pattern.js";
import {
  toKebabCase,
  updateImports as sharedUpdateImports,
  updateBarrelExport as sharedUpdateBarrelExport,
  updateManifestEntry,
} from "./refactoring-utils.js";

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
        toKebabCase(oldName),
        toKebabCase(newName),
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

      const modified = await sharedUpdateImports(sourceFile, oldName, newName);
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

      const modified = await sharedUpdateBarrelExport(
        sourceFile,
        oldName,
        newName,
      );
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
    return updateManifestEntry(this.workspaceRoot, (manifest) => {
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
    });
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

      const oldFakeName = oldName.replace(/Port$/, "Fake");
      const newFakeName = newName.replace(/Port$/, "Fake");

      const classes = sourceFile.getClasses();
      for (const cls of classes) {
        if (cls.getName() === oldFakeName) {
          cls.rename(newFakeName);
          modified = true;
        }

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

      const importsModified = await sharedUpdateImports(
        sourceFile,
        oldName,
        newName,
      );
      modified = modified || importsModified;

      if (modified) {
        const oldFileName = path.basename(relativePath);
        const newFileName = oldFileName.replace(
          toKebabCase(oldName),
          toKebabCase(newName),
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
}

// Made with Bob
