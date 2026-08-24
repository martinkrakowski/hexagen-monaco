/**
 * Layer-purity policy (AUD-011 / ADR-0054 §2).
 *
 * The pre-existing layer check in `cli.ts` only ever produced a finding when an
 * import resolved to an in-project source file. That left three holes, all
 * catalogued in ADR-0054 §2 and the 2026-08-13 review:
 *
 *  1. **Cross-layer relative imports** — a specifier starting with `.` or `/`
 *     was unconditionally treated as "relative import within same package -
 *     allowed", so `domain/x.ts` importing `../infrastructure/db.js` was never
 *     inspected. (`cross-layer-relative-import`)
 *  2. **Node builtins in domain/application** — `node:fs` has no in-project
 *     source file, so the `getModuleSpecifierSourceFile()`-gated check produced
 *     nothing. (`node-builtin-in-layer`)
 *  3. **npm packages in domain** — same blind spot: a bare package specifier
 *     resolves into `node_modules` (explicitly excluded) or nowhere at all.
 *     (`npm-package-in-domain`)
 *
 * Class 3 carries an ALLOWLIST rather than a blanket ban, per ADR-0054 §2c: the
 * HEX-026 disposition accepts `js-yaml` inside the manifest domain (YAML text is
 * that domain's core artifact). The allowlist is declarative and lives in
 * `linter-config.yaml` alongside `global_whitelist` / `package_rules`, so a
 * project states its exception in config instead of the linter hard-coding it.
 * Generated projects get an EMPTY allowlist by default — the host's exception is
 * not granted to downstream projects (ADR-0054 §4).
 *
 * Everything here is pure: no filesystem access, no `process.*`. The CLI walks
 * the tree and feeds these predicates; the predicates decide.
 */
import path from "node:path";
import { builtinModules } from "node:module";
import { importPathSatisfiesLayers } from "./layer-import-violation.js";

/** Stable rule identifiers. These are part of the baseline key — renaming one
 * invalidates every baseline entry that carries it, so treat them as a
 * contract, not as display text. */
export type LayerPurityRule =
  | "cross-layer-relative-import"
  | "node-builtin-in-layer"
  | "npm-package-in-domain";

export interface LayerPurityViolation {
  rule: LayerPurityRule;
  /** Detail line, appended to the CLI's `<Kind> Violation in [pkg]` header. */
  detail: string;
}

/**
 * A per-context exception list for rule 3 (`npm-package-in-domain`).
 *
 * ```yaml
 * domain_package_allowlist:
 *   - package: manifest-generation
 *     allowed_packages: [js-yaml]
 * ```
 *
 * `package` is the bounded-context (workspace directory) name; `*` applies the
 * entry to every context.
 */
export interface DomainPackageAllowlistEntry {
  package: string;
  allowed_packages?: string[];
}

/** Layer directory names recognised when classifying an import target. */
export const DEFAULT_LAYER_NAMES: readonly string[] = [
  "domain",
  "application",
  "infrastructure",
  "presentation",
];

const BUILTIN_MODULES = new Set(builtinModules);

/** Mirrors the CLI's long-standing predicate for "not a package specifier". */
export function isRelativeSpecifier(moduleSpecifier: string): boolean {
  return moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/");
}

/**
 * `node:fs`, `fs`, `fs/promises`, `node:fs/promises` — all builtins.
 *
 * The `node:` prefix is authoritative on its own (a package cannot claim it), so
 * it short-circuits; otherwise the first path segment is matched against Node's
 * own `builtinModules` list rather than a hand-maintained copy that would drift.
 */
export function isNodeBuiltinSpecifier(moduleSpecifier: string): boolean {
  if (moduleSpecifier.startsWith("node:")) return true;
  if (BUILTIN_MODULES.has(moduleSpecifier)) return true;
  const head = moduleSpecifier.split("/")[0];
  return BUILTIN_MODULES.has(head);
}

/** True for the project's own workspace packages (`@scope` / `@scope/pkg/...`). */
export function isWorkspaceSpecifier(
  moduleSpecifier: string,
  scope: string,
): boolean {
  return moduleSpecifier === scope || moduleSpecifier.startsWith(`${scope}/`);
}

/**
 * The npm package a bare specifier belongs to: `js-yaml/dist/x` → `js-yaml`,
 * `@octokit/rest/sub` → `@octokit/rest`. Returns null for relative specifiers.
 */
export function npmPackageNameOf(moduleSpecifier: string): string | null {
  if (isRelativeSpecifier(moduleSpecifier)) return null;
  const segments = moduleSpecifier.split("/");
  if (moduleSpecifier.startsWith("@")) {
    if (segments.length < 2) return null;
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] || null;
}

/**
 * Which layer does this path sit in? The LAST matching segment wins, so a file
 * under `application/services/domain-events/` is classified by its deepest
 * layer segment rather than by whichever name happens to appear first.
 */
export function detectLayer(
  filePath: string,
  layerNames: readonly string[] = DEFAULT_LAYER_NAMES,
): string | null {
  const segments = filePath.split(/[\\/]+/);
  let found: string | null = null;
  for (const segment of segments) {
    if (layerNames.includes(segment)) found = segment;
  }
  return found;
}

export interface FileLayerResolution {
  contextRootAbs?: string;
  layerDirs?: Readonly<Record<string, readonly string[]>>;
  layerNames?: readonly string[];
}

function posixJoinRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Hexagonal layer a file belongs to. When `layerDirs` is set (layout.yaml),
 * directory lists like `src/core` map onto `domain` even if no `/domain/`
 * segment exists. Otherwise falls back to `detectLayer`.
 */
export function resolveFileHexagonalLayer(
  filePath: string,
  options: FileLayerResolution = {},
): string | null {
  const {
    contextRootAbs,
    layerDirs,
    layerNames = DEFAULT_LAYER_NAMES,
  } = options;

  if (layerDirs && contextRootAbs) {
    const posixFile = filePath.replace(/\\/g, "/");
    const posixRoot = posixJoinRoot(contextRootAbs);
    if (posixFile === posixRoot || posixFile.startsWith(`${posixRoot}/`)) {
      const rel =
        posixFile === posixRoot ? "" : posixFile.slice(posixRoot.length + 1);
      let best: { layer: string; len: number } | null = null;
      for (const [layer, dirs] of Object.entries(layerDirs)) {
        for (const dir of dirs) {
          const normalized = dir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
          if (rel === normalized || rel.startsWith(`${normalized}/`)) {
            if (!best || normalized.length > best.len) {
              best = { layer, len: normalized.length };
            }
          }
        }
      }
      if (best) return best.layer;
    }
  }

  return detectLayer(filePath, layerNames);
}

/** Absolute path a relative specifier points at, extension-agnostic. */
export function resolveRelativeImportPath(
  fromFilePath: string,
  moduleSpecifier: string,
): string {
  if (moduleSpecifier.startsWith("/")) return path.normalize(moduleSpecifier);
  const resolved = path.resolve(path.dirname(fromFilePath), moduleSpecifier);
  // On win32, path.resolve reinterprets a POSIX-absolute ("/repo/…") importing
  // file as drive-relative and fabricates a drive prefix ("D:\repo\…"), which
  // breaks the layout prefix matching downstream — keep the input's style.
  if (path.sep !== "/" && fromFilePath.startsWith("/")) {
    return resolved.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/");
  }
  return resolved;
}

export interface CrossLayerRelativeInput {
  /** Absolute path of the importing file. */
  filePath: string;
  moduleSpecifier: string;
  /** Layer the importing file belongs to (`domain` | `application`). */
  sourceLayer: string;
  /** `allowed_imports` in force for that file, from `layer-rules.yaml`. */
  allowed: string[];
  scope: string;
  workspacesDir: string;
  sharedKernelAllowed?: boolean;
  layerNames?: readonly string[];
  contextRootAbs?: string;
  layerDirs?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Rule 1 — a relative import that lands in a DIFFERENT layer than the importing
 * file's, and that the file's `allowed_imports` do not cover.
 *
 * Deliberate non-findings:
 *  - a target with no layer segment at all (e.g. `../../config.js` at package
 *    root) is not this rule's business — it is a composition-root leak, tracked
 *    separately;
 *  - a target in the SAME layer is always legal, whatever `allowed_imports`
 *    says: a domain file may always reach another domain file. Without this
 *    short-circuit the host's `domain` rule (which lists only scoped packages)
 *    would flag every intra-domain import in the repo.
 *
 * The allowed-check reuses `importPathSatisfiesLayers`, so a relative import is
 * judged by exactly the same token semantics as a resolved package import.
 */
export function checkCrossLayerRelativeImport(
  input: CrossLayerRelativeInput,
): LayerPurityViolation | null {
  const {
    filePath,
    moduleSpecifier,
    sourceLayer,
    allowed,
    scope,
    workspacesDir,
    sharedKernelAllowed = false,
    layerNames = DEFAULT_LAYER_NAMES,
    contextRootAbs,
    layerDirs,
  } = input;

  if (!isRelativeSpecifier(moduleSpecifier)) return null;

  const targetPath = resolveRelativeImportPath(filePath, moduleSpecifier);
  const targetLayer = resolveFileHexagonalLayer(targetPath, {
    contextRootAbs,
    layerDirs,
    layerNames,
  });
  if (targetLayer === null) return null;
  if (targetLayer === sourceLayer) return null;

  // The layer rules name the target layer outright (`application` may import
  // `domain`). Checked BEFORE the path-shaped fallback because a barrel import
  // resolves to the layer directory itself (`../../domain`), which the
  // `/domain/` substring test in importPathSatisfiesLayers cannot match — that
  // would turn a legal barrel import into a false positive.
  if (allowed.includes(targetLayer)) return null;

  if (
    importPathSatisfiesLayers(
      targetPath,
      allowed,
      scope,
      workspacesDir,
      sharedKernelAllowed,
    )
  ) {
    return null;
  }

  return {
    rule: "cross-layer-relative-import",
    detail:
      `Relative import '${moduleSpecifier}' crosses out of the '${sourceLayer}' layer into '${targetLayer}'.\n` +
      `  Allowed imports for this layer: ${allowed.join(", ") || "(none)"}`,
  };
}

/**
 * Rule 2 — a Node builtin imported from `domain` or `application`. Both layers
 * are framework-free by contract; reaching for `node:fs` there is infrastructure
 * leaking inward. Other layers (infrastructure, presentation) are unaffected.
 */
export function checkNodeBuiltinInLayer(
  sourceLayer: string,
  moduleSpecifier: string,
): LayerPurityViolation | null {
  if (sourceLayer !== "domain" && sourceLayer !== "application") return null;
  if (!isNodeBuiltinSpecifier(moduleSpecifier)) return null;
  return {
    rule: "node-builtin-in-layer",
    detail:
      `Node builtin '${moduleSpecifier}' imported in the '${sourceLayer}' layer.\n` +
      `  Move the I/O behind a port and import it from infrastructure.`,
  };
}

export interface DomainPackageInput {
  moduleSpecifier: string;
  /** Bounded context (workspace directory) the domain file belongs to. */
  contextName: string;
  scope: string;
  allowlist?: DomainPackageAllowlistEntry[];
}

/** Is `packageName` allowlisted for `contextName`'s domain layer? */
export function isDomainPackageAllowed(
  packageName: string,
  contextName: string,
  allowlist: DomainPackageAllowlistEntry[] = [],
): boolean {
  return allowlist.some(
    (entry) =>
      (entry.package === contextName || entry.package === "*") &&
      (entry.allowed_packages ?? []).includes(packageName),
  );
}

/**
 * Rule 3 — an npm package imported in a `domain` file, unless allowlisted.
 *
 * Workspace-scoped specifiers are NOT this rule's business: they are already
 * governed by `layer-rules.yaml`'s `allowed_imports` and the ADR-0043
 * cross-context ladder. Node builtins belong to rule 2, so they are skipped here
 * to keep one finding per import. Per ADR-0054 §2c the ban is domain-only —
 * application is the composition/orchestration seam and keeps its packages.
 */
export function checkNpmPackageInDomain(
  input: DomainPackageInput,
): LayerPurityViolation | null {
  const { moduleSpecifier, contextName, scope, allowlist = [] } = input;

  if (isRelativeSpecifier(moduleSpecifier)) return null;
  if (isNodeBuiltinSpecifier(moduleSpecifier)) return null;
  if (isWorkspaceSpecifier(moduleSpecifier, scope)) return null;

  const packageName = npmPackageNameOf(moduleSpecifier);
  if (!packageName) return null;
  if (isDomainPackageAllowed(packageName, contextName, allowlist)) return null;

  return {
    rule: "npm-package-in-domain",
    detail:
      `npm package '${packageName}' imported in the domain layer (specifier '${moduleSpecifier}').\n` +
      `  Wrap it in an adapter, or declare the exception under 'domain_package_allowlist' in linter-config.yaml.`,
  };
}
