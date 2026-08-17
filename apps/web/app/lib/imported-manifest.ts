import yaml from "js-yaml";
import { ManifestSchema } from "@hexagen/project-configuration";

/**
 * Import round-trip integrity (Item 1): helpers shared by every export and
 * generation surface that must treat an imported project's stored
 * `manifestYaml` — not the lossy `wizardToManifest` projection — as the
 * source of truth (ZIP export, GitHub scaffold publish, code-view generate/
 * download, the architecture ZIP, and `handleGenerate`).
 */

/**
 * Blocking-error copy for the fail-closed export/generation paths. Falling
 * back to `wizardToManifest` on a corrupt manifest would silently recreate
 * the exact data-loss path this arc removes, so the flows abort with this
 * message instead.
 */
export const IMPORTED_MANIFEST_CORRUPT_MESSAGE =
  "This project's manifest data is corrupted, so exporting it would lose " +
  "architecture. Re-import the manifest or regenerate the project, then try again.";

/**
 * True when the given formState marks the project as manifest-first. Absent
 * `manifestSource` ≡ "wizard" (legacy records and every wizard-authored flow),
 * so ONLY an explicit "imported" activates the manifest-as-source-of-truth
 * paths — a false negative merely preserves today's behavior.
 */
export function isImportedFormState(formState: unknown): boolean {
  return (
    typeof formState === "object" &&
    formState !== null &&
    (formState as Record<string, unknown>).manifestSource === "imported"
  );
}

export type ImportedManifestParseResult =
  | { ok: true; manifest: Record<string, unknown> }
  | { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Overlay schema-normalized values onto the raw mapping so known fields are
 * canonicalized (e.g. `"Core"` → `"core"`) without dropping keys the schema
 * does not declare.
 */
export function mergeLosslessManifest(
  raw: Record<string, unknown>,
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const [key, normVal] of Object.entries(normalized)) {
    const rawVal = raw[key];
    if (isPlainObject(normVal) && isPlainObject(rawVal)) {
      out[key] = mergeLosslessManifest(rawVal, normVal);
    } else if (Array.isArray(normVal) && Array.isArray(rawVal)) {
      const length = Math.max(normVal.length, rawVal.length);
      const merged: unknown[] = [];
      for (let i = 0; i < length; i += 1) {
        const n = normVal[i];
        const r = rawVal[i];
        if (isPlainObject(n) && isPlainObject(r)) {
          merged.push(mergeLosslessManifest(r, n));
        } else if (i < normVal.length) {
          merged.push(n);
        } else {
          merged.push(r);
        }
      }
      out[key] = merged;
    } else {
      out[key] = normVal;
    }
  }
  return out;
}

/**
 * Parse a stored `manifestYaml` into the object the export/generate routes
 * accept in their `manifest` field.
 *
 * Fail closed only on a true parse failure (empty input, YAML syntax error,
 * or a non-mapping document). An unimplemented / schema-unknown shape is
 * returned as the raw mapping so known fields are never dropped.
 */
export function parseImportedManifest(
  manifestYaml: string | null | undefined,
): ImportedManifestParseResult {
  if (typeof manifestYaml !== "string" || manifestYaml.trim().length === 0) {
    return { ok: false, message: IMPORTED_MANIFEST_CORRUPT_MESSAGE };
  }
  let loaded: unknown;
  try {
    // Stored manifests may be YAML text OR `JSON.stringify` output (the
    // pre-fix autosave defect wrote JSON) — JSON ⊂ YAML, so one loader covers both.
    loaded = yaml.load(manifestYaml);
  } catch {
    return { ok: false, message: IMPORTED_MANIFEST_CORRUPT_MESSAGE };
  }
  if (!isPlainObject(loaded)) {
    return { ok: false, message: IMPORTED_MANIFEST_CORRUPT_MESSAGE };
  }
  return { ok: true, manifest: losslessManifest(loaded) };
}

function losslessManifest(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = ManifestSchema.safeParse(raw);
  if (parsed.success) {
    return mergeLosslessManifest(raw, parsed.data as Record<string, unknown>);
  }
  const knownOnly: Record<string, unknown> = {};
  for (const key of Object.keys(ManifestSchema.shape)) {
    if (key in raw) knownOnly[key] = raw[key];
  }
  const knownParsed = ManifestSchema.safeParse(knownOnly);
  if (knownParsed.success) {
    return mergeLosslessManifest(
      raw,
      knownParsed.data as Record<string, unknown>,
    );
  }
  return raw;
}

/**
 * The imported-vs-wizard decision itself (REA-005). Three surfaces used to
 * carry a private copy of this `isImportedFormState` → `parseImportedManifest`
 * sequence — the export/publish provider, the code-view generation hook and
 * the architecture-ZIP download — so the fail-closed invariant could drift in
 * one without the others noticing. It is decided here once.
 *
 * `yamlContent` is returned alongside the parsed object because the two
 * consumers need different shapes of the SAME decision: the HTTP payload paths
 * want the parsed `manifest` object the routes accept, while the architecture
 * ZIP writes the stored YAML text verbatim (re-dumping the parsed object would
 * churn formatting/comments for no gain). Splitting that into two resolvers
 * would recreate the divergence this consolidates.
 */
export type ImportedManifestResolution =
  | { ok: true; imported: false }
  | {
      ok: true;
      imported: true;
      manifest: Record<string, unknown>;
      yamlContent: string;
    }
  | { ok: false; message: string };

export function resolveImportedManifest(
  formState: unknown,
  savedManifestYaml: string | null | undefined,
): ImportedManifestResolution {
  if (!isImportedFormState(formState)) return { ok: true, imported: false };
  const parsed = parseImportedManifest(savedManifestYaml);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  return {
    ok: true,
    imported: true,
    manifest: parsed.manifest,
    // parseImportedManifest only succeeds on a non-empty string.
    yamlContent: savedManifestYaml as string,
  };
}

/**
 * The request-body view of {@link resolveImportedManifest}: the optional
 * `manifest` field the export/generate routes read ahead of their degraded
 * `wizardToManifest(body.wizardData)` fallback. Wizard-authored projects
 * contribute no extra field, so their request stays byte-identical.
 */
export function resolveImportedManifestPayload(
  formState: unknown,
  savedManifestYaml: string | null | undefined,
):
  | { ok: true; extra: Record<string, unknown> }
  | { ok: false; message: string } {
  const resolved = resolveImportedManifest(formState, savedManifestYaml);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  return {
    ok: true,
    extra: resolved.imported ? { manifest: resolved.manifest } : {},
  };
}
