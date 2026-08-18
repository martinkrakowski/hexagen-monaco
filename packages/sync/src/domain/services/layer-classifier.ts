import type { Layer } from "./impact-analysis.types.js";

/**
 * Reduce an absolute file path to a workspace-relative POSIX path.
 *
 * Both classifiers below read a *workspace-relative POSIX* string —
 * `determinePackageName` anchors on `/^(?:packages|apps)\//` and
 * `determineLayer` matches on `/domain/`-style segments — so producing that
 * dialect is part of the same contract and lives here beside them.
 *
 * The two arguments arrive in **different dialects**, which is the whole point.
 * `filePath` reaches the caller as a ts-morph *output*: `getFilePath()` returns
 * a `StandardizedFilePath`, already slash-normalised even on Windows
 * (`C:\ws\a.ts` -> `C:/ws/a.ts`). `workspaceRoot` is a raw *input* — whatever
 * the caller handed the analyser, on Windows a native `path.join`/`os.tmpdir`
 * string full of backslashes. Subtracting one from the other with a literal
 * `` `${workspaceRoot}/` `` prefix strip therefore matched nothing on Windows
 * and left the absolute path in `FileToModify.path`, which then failed the
 * `^(?:packages|apps)/` anchor and classified every file as package "unknown".
 * `@hexagen/sync` is published and `hexagen arch refactor` runs on consumer
 * machines, so that was a consumer-facing defect, not a test-only one.
 *
 * Implemented as pure segment arithmetic rather than `node:path` because this
 * is the domain layer and the architectural linter (rightly) bans node builtins
 * here. For the inputs this code path produces — two absolute paths under a
 * common root — it agrees exactly with the platform-correct reference
 * (`path.win32.relative` re-standardised to slashes for drive-letter roots,
 * `path.posix.relative` for POSIX roots), including out-of-tree `../` escapes
 * and trailing separators on the root. Doing the arithmetic explicitly is also
 * what makes the answer host-independent: `path.relative` bound to the host
 * returns backslashes on Windows, which the `^(?:packages|apps)/` anchor
 * rejects just as hard as an absolute path, while `path.posix.relative` on a
 * POSIX host does not treat `C:/...` as absolute and resolves it against the
 * process cwd.
 */
export function toWorkspaceRelativePosixPath(
  workspaceRoot: string,
  filePath: string,
): string {
  const standardize = (value: string): string => value.replace(/\\/g, "/");
  const rootSegments = standardize(workspaceRoot)
    .replace(/\/+$/, "")
    .split("/");
  const fileSegments = standardize(filePath).split("/");

  let shared = 0;
  while (
    shared < rootSegments.length &&
    shared < fileSegments.length &&
    rootSegments[shared] === fileSegments[shared]
  ) {
    shared += 1;
  }

  const ascend = Array<string>(rootSegments.length - shared).fill("..");
  return [...ascend, ...fileSegments.slice(shared)].join("/");
}

/** Flat `layers:` / `ignore:` list from the sync layout.yaml schema. */
export interface LayoutConfig {
  contexts?:
    | string
    | Record<
        string,
        {
          root: string;
          layers?: Record<string, readonly string[]>;
        }
      >;
  root?: string;
  layers?: string[];
  ignore?: string[];
}

/** Optional per-context directory map — config-driven mode alongside convention. */
export interface LayerLayoutConfig {
  contexts?: Record<
    string,
    {
      root: string;
      layers?: Record<string, readonly string[]>;
    }
  >;
}

function posix(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripSlashes(value: string): string {
  return posix(value).replace(/\/+$/, "");
}

function contextMap(
  config?: LayoutConfig | LayerLayoutConfig,
): LayerLayoutConfig["contexts"] {
  const raw = config?.contexts;
  if (!raw || typeof raw === "string") return undefined;
  return raw;
}

function matchLayoutContext(
  relativePath: string,
  layout: LayoutConfig | LayerLayoutConfig,
): {
  name: string;
  root: string;
  rel: string;
  layers?: Record<string, readonly string[]>;
} | null {
  const contexts = contextMap(layout);
  if (!contexts) return null;
  const file = posix(relativePath);
  let best: {
    name: string;
    root: string;
    rel: string;
    layers?: Record<string, readonly string[]>;
    len: number;
  } | null = null;
  for (const [name, ctx] of Object.entries(contexts)) {
    const root = stripSlashes(ctx.root);
    if (file === root || file.startsWith(`${root}/`)) {
      if (!best || root.length > best.len) {
        const rel = file === root ? "" : file.slice(root.length + 1);
        best = { name, root, rel, layers: ctx.layers, len: root.length };
      }
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    root: best.root,
    rel: best.rel,
    layers: best.layers,
  };
}

function layerFromLayoutDirs(
  rel: string,
  layers: Record<string, readonly string[]>,
): Layer | null {
  let best: { layer: Layer; len: number } | null = null;
  for (const [layer, dirs] of Object.entries(layers)) {
    for (const dir of dirs) {
      const normalized = posix(dir).replace(/^\/+|\/+$/g, "");
      if (rel === normalized || rel.startsWith(`${normalized}/`)) {
        if (!best || normalized.length > best.len) {
          best = { layer: layer as Layer, len: normalized.length };
        }
      }
    }
  }
  return best?.layer ?? null;
}

export function determineLayer(
  relativePath: string,
  config?: LayoutConfig | LayerLayoutConfig,
): Layer {
  if (
    config &&
    "ignore" in config &&
    config.ignore?.some((ig) => relativePath.includes(ig))
  ) {
    return "ignored";
  }

  if (relativePath.includes("/__tests__/")) {
    return "test";
  }

  if (config && "layers" in config && config.layers) {
    for (const layer of config.layers) {
      if (relativePath.includes(`/${layer}/`)) {
        return layer;
      }
    }
  }

  if (relativePath.includes(".architecture/manifest.yaml")) {
    return "manifest";
  }
  if (
    relativePath.includes("tsconfig") ||
    relativePath.includes("package.json")
  ) {
    return "config";
  }

  if (config) {
    const matched = matchLayoutContext(relativePath, config);
    if (matched?.layers) {
      const fromLayout = layerFromLayoutDirs(matched.rel, matched.layers);
      if (fromLayout) return fromLayout;
    }
  }

  if (relativePath.includes("/domain/")) {
    return "domain";
  }
  if (relativePath.includes("/application/")) {
    return "application";
  }
  if (relativePath.includes("/infrastructure/")) {
    return "infrastructure";
  }
  return "unknown";
}

export function determinePackageName(
  relativePath: string,
  layout?: LayoutConfig | LayerLayoutConfig,
): string {
  if (layout) {
    const matched = matchLayoutContext(relativePath, layout);
    if (matched) return matched.name;
  }
  const match = relativePath.match(/^(?:packages|apps|tools)\/([^/]+)/);
  return match ? match[1] : "unknown";
}
