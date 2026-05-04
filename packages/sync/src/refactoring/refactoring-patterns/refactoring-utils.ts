import type { SourceFile } from "ts-morph";
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { ok, err, type Result } from "../../domain/result.js";
import type { Manifest } from "../../types/manifest.js";

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

export async function updateImports(
  sourceFile: SourceFile,
  oldName: string,
  newName: string,
): Promise<boolean> {
  let modified = false;

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
    const oldKebab = toKebabCase(oldName);
    const newKebab = toKebabCase(newName);
    if (moduleSpecifier.includes(oldKebab)) {
      const newModuleSpecifier = moduleSpecifier.replace(oldKebab, newKebab);
      importDecl.setModuleSpecifier(newModuleSpecifier);
      modified = true;
    }
  }

  return modified;
}

export async function updateBarrelExport(
  sourceFile: SourceFile,
  oldName: string,
  newName: string,
): Promise<boolean> {
  let modified = false;

  const exports = sourceFile.getExportDeclarations();
  for (const exportDecl of exports) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (moduleSpecifier) {
      const oldKebab = toKebabCase(oldName);
      const newKebab = toKebabCase(newName);
      if (moduleSpecifier.includes(oldKebab)) {
        const newModuleSpecifier = moduleSpecifier.replace(oldKebab, newKebab);
        exportDecl.setModuleSpecifier(newModuleSpecifier);
        modified = true;
      }
    }

    const namedExports = exportDecl.getNamedExports();
    for (const namedExport of namedExports) {
      if (namedExport.getName() === oldName) {
        namedExport.setName(newName);
        modified = true;
      }
    }
  }

  return modified;
}

export async function updateManifestEntry(
  workspaceRoot: string,
  updateFn: (manifest: Manifest) => void,
): Promise<Result<void, Error>> {
  try {
    const manifestPath = path.join(
      workspaceRoot,
      ".architecture/manifest.yaml",
    );
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = yaml.load(content) as Manifest;

    updateFn(manifest);

    const updatedContent = yaml.dump(manifest, { indent: 2 });
    await fs.writeFile(manifestPath, updatedContent, "utf-8");

    return ok(undefined);
  } catch (error) {
    return err(error as Error);
  }
}
