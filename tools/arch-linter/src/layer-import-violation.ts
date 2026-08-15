/**
 * Layer-import policy (GOD-002 split).
 *
 * Extracted verbatim from the inline domain/application checks that used to live
 * inside `checkArchitecturalIntegrity()` in `index.ts`. The behavior is
 * unchanged — these are the same predicates, made pure so they take their
 * closed-over state (`layerRules`, `scope`, `workspacesDir`) as parameters and
 * can be exercised in a test harness without running the CLI (which walks the
 * filesystem for a manifest and `process.exit`s on failure).
 *
 * A "layer" is a directory segment in a package (`domain`, `application`, …).
 * `layer-rules.yaml` may key a rule by a bare layer name (`application`) or by a
 * `<package>/<layer>` pair (a per-package override). `allowed_imports` lists the
 * layers/scoped packages a file in that layer may import from; a scoped token
 * (`@scope/pkg`) matches by the imported file's on-disk package directory.
 */

export interface LayerRules {
  shared_kernel?: {
    package: string;
    allowed_in_all_layers?: boolean;
  };
  layers?: {
    [layer: string]: {
      access_rule: string;
      allowed_imports?: string[];
    };
  };
  cross_package_rules?: {
    package: string;
    cannot_import?: string[];
  }[];
}

/**
 * The `allowed_imports` list that governs a file, resolved from `layer-rules`.
 *
 * Resolution order (first match wins), preserved from the original inline
 * implementation:
 *   1. a `<package>/<layer>` rule whose BOTH segments appear in the path,
 *   2. a bare `<layer>` rule whose segment appears in the path,
 *   3. the `application` rule's imports, else the hard default.
 *
 * The default (`["domain", "<scope>/shared"]`) is applied per-branch exactly as
 * before: branches 1/2 fall back to `["domain", "${scope}/shared"]` when the
 * matched rule omits `allowed_imports`; the no-rules and terminal branches fall
 * back to `["domain", scope]` and `["domain", "${scope}/shared"]` respectively —
 * these two differ, and the difference is intentional and preserved.
 */
export function getLayerAllowedImports(
  filePath: string,
  layerRules: LayerRules,
  scope: string,
): string[] {
  const layers = layerRules?.layers;
  if (!layers) return ["domain", scope];

  for (const [layerName, layerDef] of Object.entries(layers)) {
    if (layerName.includes("/")) {
      const [pkgName, layerPath] = layerName.split("/");
      if (
        filePath.includes(`/${pkgName}/`) &&
        filePath.includes(`/${layerPath}/`)
      ) {
        return layerDef.allowed_imports ?? ["domain", `${scope}/shared`];
      }
    }
  }

  for (const [layerName, layerDef] of Object.entries(layers)) {
    if (!layerName.includes("/")) {
      if (filePath.includes(`/${layerName}/`)) {
        return layerDef.allowed_imports ?? ["domain", `${scope}/shared`];
      }
    }
  }

  return layers.application?.allowed_imports ?? ["domain", `${scope}/shared`];
}

/** Whether the shared kernel is importable from every layer (default: true). */
export function isSharedKernelAllowed(layerRules: LayerRules): boolean {
  return layerRules?.shared_kernel?.allowed_in_all_layers ?? true;
}

/**
 * Does a resolved import path satisfy one of the `allowed` layer tokens?
 *
 * A scoped token (`@scope/pkg`) matches if the imported file lives under
 * `<workspacesDir>/<pkg>/`; a bare token (`domain`) matches if the path contains
 * that directory segment. Both posix and win32 separators are checked, mirroring
 * the original inline logic exactly.
 *
 * `sharedKernelAllowed` is threaded so the application layer can short-circuit
 * `${scope}/shared` to allowed — the domain layer never passed this flag, so it
 * is optional and defaults to `false` to keep the domain branch identical.
 */
export function importPathSatisfiesLayers(
  importPath: string,
  allowed: string[],
  scope: string,
  workspacesDir: string,
  sharedKernelAllowed = false,
): boolean {
  return allowed.some((a) => {
    if (a === `${scope}/shared` && sharedKernelAllowed) return true;
    if (a.startsWith("@")) {
      const pkgName = a.split("/")[1];
      return (
        importPath.includes(`/${workspacesDir}/${pkgName}/`) ||
        importPath.includes(`\\${workspacesDir}\\${pkgName}\\`)
      );
    }
    return importPath.includes(`/${a}/`) || importPath.includes(`\\${a}\\`);
  });
}
