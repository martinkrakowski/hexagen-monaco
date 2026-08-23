/**
 * Manifest schema versioning — the `ManifestSchemaVersion` value object
 * (Wave-C PR-C1, RCA #6).
 *
 * `schemaVersion` is a positive integer carried by the ROOT manifest
 * (`.architecture/manifest.yaml`); context/app files inherit the root's
 * version and never declare their own. An ABSENT key marks a legacy manifest
 * and stays fully supported — every manifest written before the key existed
 * reads exactly as before.
 *
 * Distinct from the pre-existing `version` STRING field: that one is freeform
 * metadata whose `"2.0"` value doubles as the index-form discriminator
 * (`isIndexManifest`). `schemaVersion` is the toolchain-compatibility gate.
 *
 * The compatibility check MUST run against the RAW `yaml.load` output BEFORE
 * any zod parse: `ManifestSchema`/`IndexManifestSchema` are `.strict()`, so a
 * manifest written by a newer toolchain — likely carrying keys this version
 * doesn't know — would die on "unrecognized key" first, misdiagnosing
 * "too new" as "malformed". `mergeSplitManifest` is the single seam where
 * this runs: the `hexagen` CLI consumes it via `@hexagen/sync`'s loader
 * re-export, and the arch-linter bundles the same module (ADR-0068).
 */

/** The manifest schema version this toolchain reads and writes. */
export const CURRENT_MANIFEST_SCHEMA_VERSION = 1;

/**
 * Read `schemaVersion` from a raw `yaml.load` result. `undefined` = legacy
 * manifest (no key). A present key that is not a positive integer is a hard
 * error — there is no meaningful fallback for a corrupted version stamp.
 */
export function readManifestSchemaVersion(parsed: unknown): number | undefined {
  if (parsed === null || typeof parsed !== "object") return undefined;
  const raw = (parsed as Record<string, unknown>).schemaVersion;
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new Error(
      `Invalid manifest schemaVersion: expected a positive integer, got ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

/**
 * Refuse manifests written by a NEWER toolchain with guidance instead of a
 * misleading strict-schema error. Absent key (legacy) and any version up to
 * {@link CURRENT_MANIFEST_SCHEMA_VERSION} pass — a newer reader always
 * understands older manifests (`hexagen manifest migrate` brings them
 * forward, but reading never requires it).
 */
export function assertSupportedSchemaVersion(parsed: unknown): void {
  const version = readManifestSchemaVersion(parsed);
  if (version === undefined) return;
  if (version > CURRENT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Manifest schemaVersion ${version} is newer than this toolchain supports (reads ≤ ${CURRENT_MANIFEST_SCHEMA_VERSION}). ` +
        `This manifest requires a newer @hexagen-monaco/sync — upgrade it. ` +
        `(Upgrading is always safe: a newer toolchain reads every older manifest, and \`hexagen manifest migrate\` brings one forward on demand.)`,
    );
  }
}
