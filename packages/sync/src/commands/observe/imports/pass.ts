import { promises as fs } from "node:fs";
import path from "node:path";
import { parseJsonc } from "./jsonc.js";
import {
  joinInRepo,
  makeResolver,
  type EffectiveTsconfig,
  type UnresolvedReason,
  type WorkspacePackage,
} from "./resolve.js";
import { scanSpecifiers } from "./scan.js";

/** Extensions the pass reads. Every other counted language is unread. */
export const READ_EXTENSIONS: ReadonlySet<string> = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
]);

export const DEFAULT_MAX_IMPORT_FILES = 20_000;
export const DEFAULT_MAX_IMPORT_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_IMPORT_MS = 30_000;
/** Only files up to this size are read; a larger one is noted and skipped. */
export const MAX_FILE_BYTES = 1024 * 1024;
/** A tsconfig `extends` chain is followed this many levels past the nearest file. */
export const MAX_EXTENDS_DEPTH = 5;

export interface ImportPassOptions {
  root: string;
  /** Repo-relative walked files. */
  files: readonly string[];
  packages: readonly WorkspacePackage[];
  maxFiles: number;
  maxBytes: number;
  maxMs: number;
  now: () => number;
  start: number;
  notes: string[];
  /** Per-file read limit; defaults to MAX_FILE_BYTES. A test seam, not a flag. */
  maxFileBytes?: number;
}

export interface EdgeRow {
  from: string;
  to: string;
  specifier: string;
}
export interface UnresolvedRow {
  from: string;
  specifier: string;
  reason: UnresolvedReason;
}

export type ImportPassResult =
  | { collected: true; edges: EdgeRow[]; unresolved: UnresolvedRow[] }
  | { collected: false; reason: string };

export function isReadable(file: string): boolean {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 && READ_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

const NON_LITERAL = {
  "dynamic-import": "import(<non-literal>)",
  require: "require(<non-literal>)",
} as const;

export async function runImportPass(
  options: ImportPassOptions,
): Promise<ImportPassResult> {
  const { root, files, notes } = options;
  const fileSet = new Set(files);
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const sources = files.filter(isReadable);
  if (sources.length > options.maxFiles) {
    return {
      collected: false,
      reason: `import pass file cap reached (maxImportFiles=${options.maxFiles})`,
    };
  }

  // tsconfig loading -------------------------------------------------------
  const effective = new Map<string, EffectiveTsconfig | null>();

  const readConfig = async (
    file: string,
  ): Promise<Record<string, unknown> | null> => {
    try {
      const size = (await fs.stat(path.join(root, file))).size;
      if (size > maxFileBytes) {
        notes.push(`note: ${file} is larger than 1 MiB; ignored`);
        return null;
      }
      const text = await fs.readFile(path.join(root, file), "utf8");
      const parsed = parseJsonc(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to the note
    }
    notes.push(`note: ${file} is not readable JSON; ignored`);
    return null;
  };

  const loadEffective = async (
    file: string,
  ): Promise<EffectiveTsconfig | null> => {
    const chain: { file: string; cfg: Record<string, unknown> }[] = [];
    const seen = new Set<string>();
    let cur: string | null = file;
    while (cur !== null) {
      if (seen.has(cur)) {
        notes.push(`note: tsconfig extends cycle at ${cur}; chain cut`);
        break;
      }
      if (chain.length > MAX_EXTENDS_DEPTH) {
        notes.push(
          `note: tsconfig extends chain from ${file} is deeper than ${MAX_EXTENDS_DEPTH}; the rest is ignored`,
        );
        break;
      }
      seen.add(cur);
      const cfg = await readConfig(cur);
      if (!cfg) break;
      chain.push({ file: cur, cfg });
      const ext: unknown = cfg.extends;
      if (Array.isArray(ext) && ext.length > 1) {
        notes.push(
          `note: ${cur} has an extends array; only the last entry is followed`,
        );
      }
      const spec = Array.isArray(ext) ? ext[ext.length - 1] : ext;
      if (typeof spec !== "string") break;
      if (!/^\.\.?\//.test(spec)) {
        notes.push(
          `note: ${cur} extends ${JSON.stringify(spec)}, which is not a repo-relative path; not followed`,
        );
        break;
      }
      const dir: string = cur.includes("/")
        ? cur.slice(0, cur.lastIndexOf("/"))
        : "";
      const target = joinInRepo(dir, spec);
      if (target === null) {
        notes.push(
          `note: ${cur} extends a path outside the repo; not followed`,
        );
        break;
      }
      const next: string | undefined = [
        target,
        `${target}.json`,
        `${target}/tsconfig.json`,
      ].find((c) => fileSet.has(c));
      if (!next) {
        notes.push(
          `note: ${cur} extends ${JSON.stringify(spec)}, which was not found in the repo`,
        );
        break;
      }
      cur = next;
    }
    let baseUrl: string | undefined;
    let paths: Record<string, string[]> | undefined;
    let pathsDir: string | undefined;
    for (const { file: f, cfg } of chain) {
      const opts = cfg.compilerOptions;
      if (!opts || typeof opts !== "object") continue;
      const o = opts as Record<string, unknown>;
      const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
      if (baseUrl === undefined && typeof o.baseUrl === "string") {
        const b = joinInRepo(dir, o.baseUrl);
        if (b === null) {
          notes.push(`note: ${f} baseUrl points outside the repo; ignored`);
        } else {
          baseUrl = b;
        }
      }
      if (paths === undefined && o.paths && typeof o.paths === "object") {
        // No prototype, so a `__proto__` key is an ordinary key.
        const clean: Record<string, string[]> = Object.create(null);
        for (const [k, v] of Object.entries(
          o.paths as Record<string, unknown>,
        )) {
          if (Array.isArray(v)) {
            clean[k] = v.filter((x): x is string => typeof x === "string");
          }
        }
        paths = clean;
        pathsDir = dir;
      }
    }
    if (baseUrl === undefined && paths === undefined) return null;
    return {
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(paths ? { paths, pathsBase: baseUrl ?? pathsDir ?? "" } : {}),
    };
  };

  /** Nearest `tsconfig.json` at or above `dir`, within the repo. */
  const nearestConfig = (dir: string): string | null => {
    let d = dir;
    for (;;) {
      const cand = d === "" ? "tsconfig.json" : `${d}/tsconfig.json`;
      if (fileSet.has(cand)) return cand;
      if (d === "") return null;
      d = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "";
    }
  };

  // Resolve every needed config up front, so the resolver stays synchronous.
  const dirs = new Set(
    sources.map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "")),
  );
  const byConfig = new Map<string, EffectiveTsconfig | null>();
  const dirToConfig = new Map<string, string | null>();
  for (const dir of dirs) {
    dirToConfig.set(dir, nearestConfig(dir));
  }
  for (const cfgFile of new Set(dirToConfig.values())) {
    if (cfgFile === null) continue;
    byConfig.set(cfgFile, await loadEffective(cfgFile));
  }
  for (const [dir, cfgFile] of dirToConfig) {
    effective.set(
      dir,
      cfgFile === null ? null : (byConfig.get(cfgFile) ?? null),
    );
  }

  const resolve = makeResolver({
    files: fileSet,
    packages: options.packages,
    tsconfigFor: (dir) => effective.get(dir) ?? null,
  });

  // The scan ---------------------------------------------------------------
  const edgeKeys = new Set<string>();
  const edges: EdgeRow[] = [];
  const unresolvedKeys = new Set<string>();
  const unresolved: UnresolvedRow[] = [];
  let external = 0;
  let bytes = 0;

  /** A file the pass could not read: a note, and a row so the edges never read clean. */
  const skip = (
    from: string,
    why: "unreadable" | "larger than 1 MiB",
  ): void => {
    notes.push(
      why === "unreadable"
        ? `note: ${from} unreadable; not scanned`
        : `note: ${from} is larger than 1 MiB; not scanned`,
    );
    unresolved.push({
      from,
      specifier: `<not scanned: ${why}>`,
      reason: "not-scanned",
    });
  };

  const BATCH = 32;
  for (let i = 0; i < sources.length; i += BATCH) {
    if (options.now() - options.start > options.maxMs) {
      return {
        collected: false,
        reason: `import pass time cap reached (maxImportMs=${options.maxMs})`,
      };
    }
    const batch = sources.slice(i, i + BATCH);
    const texts: (string | null)[] = [];
    for (const f of batch) {
      let size: number;
      try {
        size = (await fs.stat(path.join(root, f))).size;
      } catch {
        skip(f, "unreadable");
        texts.push(null);
        continue;
      }
      if (size > maxFileBytes) {
        skip(f, "larger than 1 MiB");
        texts.push(null);
        continue;
      }
      bytes += size;
      if (bytes > options.maxBytes) {
        return {
          collected: false,
          reason: `import pass byte cap reached (maxImportBytes=${options.maxBytes})`,
        };
      }
      try {
        texts.push(await fs.readFile(path.join(root, f), "utf8"));
      } catch {
        skip(f, "unreadable");
        texts.push(null);
      }
    }
    batch.forEach((from, idx) => {
      const text = texts[idx];
      if (text == null) return;
      for (const found of scanSpecifiers(text)) {
        if (found.specifier === null) {
          const specifier = NON_LITERAL[found.kind as keyof typeof NON_LITERAL];
          if (!specifier) continue; // a static import always has a literal
          const key = `${from}\0${specifier}`;
          if (!unresolvedKeys.has(key)) {
            unresolvedKeys.add(key);
            unresolved.push({ from, specifier, reason: "non-literal" });
          }
          continue;
        }
        const result = resolve(found.specifier, from);
        if (result.kind === "external") {
          external++;
        } else if (result.kind === "edge") {
          const key = `${from}\0${result.to}\0${found.specifier}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({ from, to: result.to, specifier: found.specifier });
          }
        } else {
          const key = `${from}\0${found.specifier}\0${result.reason}`;
          if (!unresolvedKeys.has(key)) {
            unresolvedKeys.add(key);
            unresolved.push({
              from,
              specifier: found.specifier,
              reason: result.reason,
            });
          }
        }
      }
    });
  }
  if (options.now() - options.start > options.maxMs) {
    return {
      collected: false,
      reason: `import pass time cap reached (maxImportMs=${options.maxMs})`,
    };
  }
  if (external > 0) {
    notes.push(
      `note: ${external} external specifier(s) (node builtins and dependencies) are neither edges nor unresolved`,
    );
  }
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  edges.sort(
    (a, b) =>
      cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.specifier, b.specifier),
  );
  unresolved.sort(
    (a, b) =>
      cmp(a.from, b.from) ||
      cmp(a.specifier, b.specifier) ||
      cmp(a.reason, b.reason),
  );
  return { collected: true, edges, unresolved };
}
