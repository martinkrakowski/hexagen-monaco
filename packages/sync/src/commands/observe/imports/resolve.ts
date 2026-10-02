import path from "node:path";

/**
 * Specifier resolution for the import pass. Pure: it sees only the walked
 * file set, the workspace packages and a tsconfig lookup.
 *
 * Order, per specifier: (1) relative, (2) workspace package name,
 * (3) the nearest tsconfig `paths` / `baseUrl`, (4) `#` package imports.
 * Anything no step claims is external (a node builtin or a dependency).
 */

export type UnresolvedReason =
  | "not-found"
  | "exports-subpath"
  | "non-literal"
  | "outside-repo"
  | "package-imports"
  | "not-scanned";

export type Resolution =
  | { kind: "edge"; to: string }
  | { kind: "unresolved"; reason: UnresolvedReason }
  | { kind: "external" };

export interface WorkspacePackage {
  readonly name: string;
  /** "." for the repo root, else a repo-relative directory. */
  readonly root: string;
}

/** A tsconfig reduced to what resolution needs. Paths are repo-relative, "" is the root. */
export interface EffectiveTsconfig {
  /** Absolute-in-repo directory the `baseUrl` points at, or undefined. */
  readonly baseUrl?: string;
  /** Directory the `paths` targets are relative to. */
  readonly pathsBase?: string;
  readonly paths?: Readonly<Record<string, readonly string[]>>;
}

export interface ResolveContext {
  readonly files: ReadonlySet<string>;
  readonly packages: readonly WorkspacePackage[];
  /** The effective tsconfig for the directory of the importing file. */
  readonly tsconfigFor: (fileDir: string) => EffectiveTsconfig | null;
}

export const RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const;

/** TS lets `./x.js` mean `./x.ts`. */
const JS_TO_TS: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/** Join and normalize; null when the result leaves the repo root. "" is the root. */
export function joinInRepo(dir: string, rel: string): string | null {
  if (path.posix.isAbsolute(rel)) return null;
  const joined = path.posix.normalize(
    path.posix.join(dir === "" ? "." : dir, rel),
  );
  if (joined === ".." || joined.startsWith("../")) return null;
  const bare = joined.replace(/\/$/, "");
  return bare === "." || bare === "" ? "" : bare;
}

/** Find the file a repo-relative path names, with extension and index rules. */
export function tryFile(
  files: ReadonlySet<string>,
  p: string,
  dirOnly = false,
): string | null {
  if (p !== "" && !dirOnly && files.has(p)) return p;
  if (p !== "" && !dirOnly) {
    const dot = p.lastIndexOf(".");
    const mapped =
      dot > p.lastIndexOf("/") ? JS_TO_TS[p.slice(dot)] : undefined;
    for (const ext of mapped ?? []) {
      const cand = p.slice(0, dot) + ext;
      if (files.has(cand)) return cand;
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      if (files.has(p + ext)) return p + ext;
    }
  }
  const prefix = p === "" ? "" : `${p}/`;
  for (const ext of RESOLVE_EXTENSIONS) {
    if (files.has(`${prefix}index${ext}`)) return `${prefix}index${ext}`;
  }
  return null;
}

type Step = (spec: string, fromDir: string) => Resolution | null;

const RELATIVE = /^\.\.?(\/|$)/;
/** `.\x` and `..\x`: Windows-style, relative-looking, never resolvable here. */
const WINDOWS_RELATIVE = /^\.\.?\\/;
/** `C:/x`, `C:\x` and `C:x`: a drive path, outside any repo. */
const DRIVE_PATH = /^[A-Za-z]:/;

function relativeStep(ctx: ResolveContext): Step {
  return (spec, fromDir) => {
    if (WINDOWS_RELATIVE.test(spec)) {
      return { kind: "unresolved", reason: "not-found" };
    }
    const absolute = spec.startsWith("/") || DRIVE_PATH.test(spec);
    if (!RELATIVE.test(spec) && !absolute) return null;
    const target = absolute ? null : joinInRepo(fromDir, spec);
    if (target === null) return { kind: "unresolved", reason: "outside-repo" };
    // A trailing slash, `.` and `..` name a directory: only its index counts.
    const dirOnly = spec.endsWith("/") || spec === "." || spec === "..";
    const file = tryFile(ctx.files, target, dirOnly);
    return file
      ? { kind: "edge", to: file }
      : { kind: "unresolved", reason: "not-found" };
  };
}

function workspaceStep(ctx: ResolveContext, alias: Step): Step {
  return (spec, fromDir) => {
    for (const pkg of ctx.packages) {
      if (spec === pkg.name) return { kind: "edge", to: pkg.root };
    }
    for (const pkg of ctx.packages) {
      if (spec.startsWith(`${pkg.name}/`)) {
        // A tsconfig alias for the subpath gets the first word; only when none
        // matches is it an `exports` subpath, which this pass does not read.
        return (
          alias(spec, fromDir) ?? {
            kind: "unresolved",
            reason: "exports-subpath",
          }
        );
      }
    }
    return null;
  };
}

/** `paths` key match: exact, or one `*`. Returns the captured text, or null. */
function matchKey(key: string, spec: string): string | null {
  const star = key.indexOf("*");
  if (star === -1) return key === spec ? "" : null;
  const prefix = key.slice(0, star);
  const suffix = key.slice(star + 1);
  if (
    spec.length >= prefix.length + suffix.length &&
    spec.startsWith(prefix) &&
    spec.endsWith(suffix)
  ) {
    return spec.slice(prefix.length, spec.length - suffix.length);
  }
  return null;
}

function tsconfigStep(ctx: ResolveContext): Step {
  return (spec, fromDir) => {
    const cfg = ctx.tsconfigFor(fromDir);
    if (!cfg) return null;
    if (cfg.paths) {
      // The longest matching prefix wins, as in TypeScript.
      let best: { key: string; captured: string; len: number } | null = null;
      for (const key of Object.keys(cfg.paths)) {
        const captured = matchKey(key, spec);
        if (captured === null) continue;
        const len = key.indexOf("*") === -1 ? key.length + 1 : key.indexOf("*");
        if (!best || len > best.len) best = { key, captured, len };
      }
      if (best) {
        const targets = cfg.paths[best.key] ?? [];
        let escaped = false;
        for (const target of targets) {
          const sub = target.includes("*")
            ? target.replace("*", best.captured)
            : target;
          const rel = joinInRepo(cfg.pathsBase ?? "", sub);
          if (rel === null) {
            escaped = true;
            continue;
          }
          const file = tryFile(ctx.files, rel);
          if (file) return { kind: "edge", to: file };
        }
        // A bare `*` key catches every package name; a miss there means the
        // specifier is a dependency, not a broken alias.
        if (best.key === "*") return baseUrlLookup(ctx, cfg, spec);
        return {
          kind: "unresolved",
          reason: escaped && targets.length > 0 ? "outside-repo" : "not-found",
        };
      }
    }
    return baseUrlLookup(ctx, cfg, spec);
  };
}

function baseUrlLookup(
  ctx: ResolveContext,
  cfg: EffectiveTsconfig,
  spec: string,
): Resolution | null {
  if (cfg.baseUrl === undefined) return null;
  const rel = joinInRepo(cfg.baseUrl, spec);
  if (rel === null) return null;
  const file = tryFile(ctx.files, rel);
  return file ? { kind: "edge", to: file } : null;
}

const packageImportsStep: Step = (spec) =>
  spec.startsWith("#") && spec.length > 1
    ? { kind: "unresolved", reason: "package-imports" }
    : null;

export function makeResolver(
  ctx: ResolveContext,
): (spec: string, fromFile: string) => Resolution {
  const alias = tsconfigStep(ctx);
  const steps: Step[] = [
    relativeStep(ctx),
    workspaceStep(ctx, alias),
    alias,
    packageImportsStep,
  ];
  return (spec, fromFile) => {
    const slash = fromFile.lastIndexOf("/");
    const fromDir = slash === -1 ? "" : fromFile.slice(0, slash);
    for (const step of steps) {
      const result = step(spec, fromDir);
      if (result) return result;
    }
    return { kind: "external" };
  };
}
