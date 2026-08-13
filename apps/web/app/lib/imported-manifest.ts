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

/**
 * Parse + schema-validate a stored `manifestYaml` into the parsed `Manifest`
 * object the export/generate routes accept in their `manifest` field (the
 * routes type it as an OBJECT, not YAML text — `body.manifest ?? wizardToManifest(...)`).
 *
 * Fail closed: a YAML error or `ManifestSchema` failure returns `ok: false`
 * with the blocking copy — callers must abort, never fall back to the
 * degraded wizard projection. The schema's normalized output (`parsed.data`)
 * is returned so case-drifted enums (e.g. `"Core"`) reach the generator in
 * canonical form, same as the accept-time parse.
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
  const parsed = ManifestSchema.safeParse(loaded);
  if (!parsed.success) {
    return { ok: false, message: IMPORTED_MANIFEST_CORRUPT_MESSAGE };
  }
  return { ok: true, manifest: parsed.data as Record<string, unknown> };
}
