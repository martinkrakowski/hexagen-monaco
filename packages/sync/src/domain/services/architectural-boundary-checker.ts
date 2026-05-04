import type { Manifest } from "../../types/manifest.js";
import type { ArchitecturalImpact } from "./impact-analysis.types.js";

export interface BoundaryCheckInput {
  layer: string;
  imports: string[];
}

export function isDomainLayerViolation(imports: string[]): boolean {
  return imports.some((imp) => imp.includes("/infrastructure/"));
}

export function isApplicationLayerViolation(imports: string[]): boolean {
  return imports.some(
    (imp) =>
      imp.includes("/infrastructure/") &&
      !imp.includes("/infrastructure/adapters/"),
  );
}

export function checkManifestDependency(
  fromPackage: string,
  toPackage: string,
  manifest: Manifest,
): boolean {
  const fromContext = manifest.bounded_contexts?.find(
    (c) => c.name === fromPackage,
  );
  const toContext = manifest.bounded_contexts?.find(
    (c) => c.name === toPackage,
  );

  if (!fromContext || !toContext) {
    return true;
  }

  const hasDependency = fromContext.depends_on?.some(
    (contextName) => contextName === toPackage,
  );
  return !hasDependency;
}

export function assessArchitecturalImpact(
  files: Array<{ layer: string; packageName: string; imports?: string[] }>,
  crossPackageDeps: Array<{ fromPackage: string; toPackage: string }>,
  manifest: Manifest,
): ArchitecturalImpact {
  for (const file of files) {
    if (file.layer === "domain" && file.imports) {
      if (isDomainLayerViolation(file.imports)) {
        return "BOUNDARY_VIOLATION";
      }
    }

    if (file.layer === "application" && file.imports) {
      if (isApplicationLayerViolation(file.imports)) {
        return "BOUNDARY_VIOLATION";
      }
    }
  }

  for (const dep of crossPackageDeps) {
    if (checkManifestDependency(dep.fromPackage, dep.toPackage, manifest)) {
      return "BOUNDARY_VIOLATION";
    }
  }

  return "SAFE";
}
