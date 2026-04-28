// rename-entity.pattern.ts – Rename domain entity refactoring pattern
// Part of Phase 7: Refactoring Assistant
//
// This pattern renames a domain entity and updates all references.
// Similar to rename-use-case but focuses on domain layer entities.

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
 * Pattern for renaming domain entities
 */
export class RenameEntityPattern implements RefactoringPattern {
  name = "rename-entity";
  description = "Rename a domain entity and update all references";

  private project: Project;

  constructor(private readonly workspaceRoot: string) {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        target: 99,
        module: 99,
        moduleResolution: 100,
      },
    });
  }

  validate(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Result<void, Error> {
    if (!request.newName) {
      return err(new Error("New name is required for rename operations"));
    }

    if (!/^[A-Z][a-zA-Z0-9]*$/.test(request.newName)) {
      return err(
        new Error(`New name "${request.newName}" must be in PascalCase`),
      );
    }

    if (impact.architecturalImpact === "BOUNDARY_VIOLATION") {
      return err(
        new Error("Refactoring would violate architectural boundaries"),
      );
    }

    return ok(undefined);
  }

  async execute(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Promise<Result<RefactoringResult, Error>> {
    const filesModified: string[] = [];
    const errors: Error[] = [];

    try {
      // Load affected files
      for (const file of impact.filesToModify) {
        if (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) {
          try {
            this.project.addSourceFileAtPath(
              path.join(this.workspaceRoot, file.path),
            );
          } catch {
            // Already added
          }
        }
      }

      // Rename entity files
      const entityFiles = impact.filesToModify.filter(
        (f) => f.reason.includes("Declares") && f.layer === "domain",
      );
      for (const file of entityFiles) {
        const result = await this.renameEntityFile(
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

      // Update imports
      for (const file of impact.filesToModify.filter((f) =>
        f.reason.includes("Imports"),
      )) {
        const result = await this.updateReferences(
          file.path,
          request.target,
          request.newName!,
        );
        if (result.success && result.value.length > 0) {
          filesModified.push(...result.value);
        }
      }

      // Update manifest
      if (impact.filesToModify.some((f) => f.layer === "manifest")) {
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

      await this.project.save();

      return ok({
        success: errors.length === 0,
        filesModified: Array.from(new Set(filesModified)),
        errors,
        warnings: [],
      });
    } catch (error) {
      return err(error as Error);
    }
  }

  private async renameEntityFile(
    relativePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<string[], Error>> {
    try {
      const sourceFile = this.project.getSourceFile(
        path.join(this.workspaceRoot, relativePath),
      );
      if (!sourceFile) return err(new Error(`File not found: ${relativePath}`));

      const classDecl = sourceFile.getClass(oldName);
      if (classDecl) classDecl.rename(newName);

      const interfaceDecl = sourceFile.getInterface(oldName);
      if (interfaceDecl) interfaceDecl.rename(newName);

      const typeAlias = sourceFile.getTypeAlias(oldName);
      if (typeAlias) typeAlias.rename(newName);

      return ok([relativePath]);
    } catch (error) {
      return err(error as Error);
    }
  }

  private async updateReferences(
    relativePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<string[], Error>> {
    try {
      const sourceFile = this.project.getSourceFile(
        path.join(this.workspaceRoot, relativePath),
      );
      if (!sourceFile) return ok([]);

      let modified = false;

      for (const importDecl of sourceFile.getImportDeclarations()) {
        for (const namedImport of importDecl.getNamedImports()) {
          if (namedImport.getName() === oldName) {
            namedImport.setName(newName);
            modified = true;
          }
        }
      }

      return ok(modified ? [relativePath] : []);
    } catch (error) {
      return err(error as Error);
    }
  }

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

      if (manifest.bounded_contexts) {
        for (const context of manifest.bounded_contexts) {
          if (context.layers?.domain?.entities) {
            const index = context.layers.domain.entities.indexOf(oldName);
            if (index !== -1) {
              context.layers.domain.entities[index] = newName;
            }
          }
        }
      }

      await fs.writeFile(
        manifestPath,
        yaml.dump(manifest, { indent: 2 }),
        "utf-8",
      );
      return ok(undefined);
    } catch (error) {
      return err(error as Error);
    }
  }
}

// Made with Bob
