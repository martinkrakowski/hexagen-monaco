/**
 * Cross-context import legality (ADR-0043, RCA #8).
 *
 * The manifest is the per-context source of truth: a context may import what
 * its `depends_on` declares, plus every context declared `type: shared-kernel`.
 * The invariants config (`linter-config.yaml`) remains operative as
 * *additional* constraints — `global_whitelist` and `allowed_imports` grant
 * beyond the manifest, `cannot_import` is the explicit denial that beats a
 * manifest grant, and `restricted_to` still closes over imports not granted
 * by anything above it.
 *
 * Precedence ladder (first match wins):
 *   1. non-scope / same-package        → never a violation
 *   2. global_whitelist                → pass (historically beats cannot_import)
 *   3. cannot_import                   → VIOLATION (explicit denial)
 *   4. imported context is shared-kernel-typed in the manifest → pass
 *   5. importing context's manifest depends_on declares it     → pass
 *   6. allowed_imports                 → pass
 *   7. restricted_to present           → pass iff listed
 *   8. otherwise                       → VIOLATION
 *
 * `depends_on` and `restricted_to` express the same concept in two documents;
 * the union governs (a grant in either suffices). To forbid a manifest-declared
 * edge, use `cannot_import`. See the ADR for the full rationale.
 */
import type { LinterConfig } from "./subpath-violation.js";

export interface ManifestImportGrants {
  /** context name → the bare context names its manifest `depends_on` declares */
  dependsOn: ReadonlyMap<string, readonly string[]>;
  /** contexts declared `type: shared-kernel` in the manifest — importable from everywhere */
  sharedKernels: ReadonlySet<string>;
}

/**
 * Derive the manifest-side grants once per run. Accepts the manifest's
 * `bounded_contexts` array structurally (name/type/depends_on are the only
 * fields read), so tests don't need a full Manifest.
 */
export function buildManifestImportGrants(
  contexts:
    | readonly { name: string; type?: string; depends_on?: string[] }[]
    | undefined,
): ManifestImportGrants {
  const dependsOn = new Map<string, readonly string[]>();
  const sharedKernels = new Set<string>();
  for (const ctx of contexts ?? []) {
    if (ctx.depends_on && ctx.depends_on.length > 0) {
      dependsOn.set(ctx.name, ctx.depends_on);
    }
    if (ctx.type === "shared-kernel") {
      sharedKernels.add(ctx.name);
    }
  }
  return { dependsOn, sharedKernels };
}

export function isGlobalWhitelisted(
  moduleSpecifier: string,
  scope: string,
  config: LinterConfig,
): boolean {
  const whitelist = config.global_whitelist ?? [`${scope}/shared`];
  return whitelist.some((pattern: string) => {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -2);
      return moduleSpecifier.startsWith(prefix);
    }
    return moduleSpecifier === pattern;
  });
}

/** `@scope/pkg/**` glob, exact specifier, or specifier-prefix match. */
function matchesPattern(moduleSpecifier: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    return moduleSpecifier.startsWith(pattern.slice(0, -2));
  }
  return (
    moduleSpecifier === pattern || moduleSpecifier.startsWith(pattern + "/")
  );
}

function getPackageRestrictions(
  packageName: string,
  config: LinterConfig,
): {
  restrictedTo: string[];
  cannotImport: string[];
  allowedImports: string[];
} {
  const pkgRule = config.package_rules?.find(
    (r: NonNullable<LinterConfig["package_rules"]>[number]) =>
      r.name === packageName,
  );
  return {
    restrictedTo: pkgRule?.restricted_to ?? [],
    cannotImport: pkgRule?.cannot_import ?? [],
    allowedImports: pkgRule?.allowed_imports ?? [],
  };
}

export function isCrossPackageViolation(
  fromPackage: string,
  moduleSpecifier: string,
  importedPkg: string,
  scope: string,
  config: LinterConfig,
  grants: ManifestImportGrants,
): boolean {
  // Slash boundary: a prefix-sibling scope (e.g. @hexagen-monaco/* under scope
  // @hexagen, or @hexagenic/*) is NOT in-scope — same doctrine as the tooling
  // allowlist in namespacing.test.ts and the subpath rule's `^${scope}/` anchor.
  if (!moduleSpecifier.startsWith(scope + "/")) return false;
  if (isGlobalWhitelisted(moduleSpecifier, scope, config)) return false;

  if (!importedPkg || importedPkg === fromPackage) return false;

  const { cannotImport, allowedImports, restrictedTo } = getPackageRestrictions(
    fromPackage,
    config,
  );
  if (cannotImport.includes(importedPkg)) return true;

  // Manifest grants (ADR-0043): shared-kernel-typed contexts are importable
  // from everywhere; a declared depends_on edge legalizes the import — deep
  // subpaths included, since the grant is per-package, not per-entry-point.
  if (grants.sharedKernels.has(importedPkg)) return false;
  if (grants.dependsOn.get(fromPackage)?.includes(importedPkg)) return false;

  if (allowedImports.length > 0) {
    const isAllowed = allowedImports.some((allowed) =>
      matchesPattern(moduleSpecifier, allowed),
    );
    if (isAllowed) return false;
  }

  if (restrictedTo.length > 0) {
    return !restrictedTo.some((allowed) =>
      matchesPattern(moduleSpecifier, allowed),
    );
  }

  return true;
}
