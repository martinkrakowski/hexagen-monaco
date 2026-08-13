/**
 * THE single layer-folder resolver (A2 / F16).
 *
 * Several code paths used to guess the on-disk directory for a layer/stub
 * site independently — the emission plan and stub placement hardcoded
 * `src/<layer>/<site>` while `ensureLayerFolders` consumed
 * `generator.sync.layers[*].folder` — so a manifest that set
 * `application: { folder: "src/app" }` scaffolded `src/app/...` but stubs
 * landed in `src/application/...`. Every consumer that turns a (layer, site)
 * pair into a directory now goes through `resolveLayerDir`.
 *
 * Rules:
 *  - The LAYER folder comes from `generator.sync.layers[layer].folder`,
 *    falling back to the `src/<layer>` convention. A configured folder that
 *    is absolute or path-traverses out of the package is ignored (fall back
 *    to convention) — manifests can arrive unvalidated via `/api/generate`,
 *    and this is the same traversal posture as the SyncEngine module guard.
 *  - The SITE subfolder is the conventional kebab-case vocabulary
 *    (`entities`, `value-objects`, `use-cases`, `ports/in`, ...).
 *    Hyphen/underscore are treated as the same separator for KNOWN sites:
 *    the wizard's layer config names `value_objects` while every emitter
 *    (stub plan, add-on template payloads and their import specifiers, this
 *    monorepo's own layout) uses `value-objects` — F16's duplicate-folder
 *    bug was exactly that split. Known-site spellings normalize to the
 *    kebab-case convention; unknown custom subfolders pass through verbatim.
 */

import type { LayerConfig } from "../../types/manifest.js";

export type LayerKind = "domain" | "application" | "infrastructure";

export type LayersConfig = Record<string, LayerConfig>;

/**
 * The conventional subfolder vocabulary, kebab-case (the emission plan's
 * historical hardcoded set plus the bare `ports` parent used by layer
 * configs). Membership is decided on the hyphen/underscore-insensitive
 * canonical form — see `normalizeSubfolder`.
 */
const KNOWN_SITES = new Set([
  "entities",
  "value-objects",
  "services",
  "ports",
  "ports/in",
  "ports/out",
  "use-cases",
  "adapters",
]);

function canonicalSite(subfolder: string): string {
  return subfolder.toLowerCase().replace(/_/g, "-");
}

/**
 * Normalize a subfolder spelling: a spelling of a KNOWN site (any
 * hyphen/underscore/case variant, e.g. `value_objects`) collapses to the
 * conventional kebab-case form; anything else (a genuinely custom subfolder)
 * is returned verbatim. Used by `ensureLayerFolders` too, so the scaffolded
 * skeleton and the emitted files agree on ONE folder per site (F16).
 */
export function normalizeSubfolder(subfolder: string): string {
  const canonical = canonicalSite(subfolder);
  return KNOWN_SITES.has(canonical) ? canonical : subfolder;
}

/**
 * A configured layer folder must stay inside the package: reject absolute
 * paths and `..` segments (unvalidated `/api/generate` manifests reach this
 * code — same posture as the SyncEngine module-name guard and
 * cross-context's `isSafePathSegment`).
 */
function isSafeLayerFolder(folder: string): boolean {
  if (folder.length === 0) return false;
  if (folder.startsWith("/") || folder.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(folder)) return false; // windows drive-absolute
  return !folder
    .split(/[/\\]/)
    .some((segment) => segment === ".." || segment === "");
}

/**
 * Resolve the on-disk directory (POSIX-style, relative to the package root)
 * for a layer — optionally a site inside it — from `generator.sync.layers`,
 * with a fallback to the `src/<layer>/<conventional-site>` convention.
 *
 * `resolveLayerDir(layers, "application", "ports/out")` →
 * `"src/app/ports/out"` when the manifest configures
 * `application: { folder: "src/app" }`, `"src/application/ports/out"`
 * otherwise.
 */
export function resolveLayerDir(
  layers: LayersConfig | undefined,
  layer: LayerKind,
  subfolder?: string,
): string {
  const configured = layers?.[layer]?.folder;
  const folder =
    configured !== undefined && isSafeLayerFolder(configured)
      ? configured
      : `src/${layer}`;
  if (subfolder === undefined) return folder;
  return `${folder}/${normalizeSubfolder(subfolder)}`;
}

/**
 * Convenience form for emission-site strings (`"domain/value-objects"`,
 * `"application/ports/in"`, ...): split into (layer, site) and resolve.
 */
export function resolveEmissionDir(
  layers: LayersConfig | undefined,
  site: `${LayerKind}/${string}`,
): string {
  const slash = site.indexOf("/");
  const layer = site.slice(0, slash) as LayerKind;
  return resolveLayerDir(layers, layer, site.slice(slash + 1));
}
