/**
 * MigrateManifestUseCase (Wave-C PR-C1, RCA #6) — bring a manifest forward to
 * the current schema version: apply every registered migration past its
 * stamped version, then stamp `schemaVersion`.
 *
 * The pipeline contract is TEXT → TEXT. Manifests are hand-maintained YAML
 * full of comments (the split header, per-key annotations); a parse→mutate→
 * dump round-trip would silently destroy them all. The stamp is therefore a
 * textual insertion/replacement, and registered migrations receive the raw
 * text too — a future structural migration that genuinely cannot be expressed
 * textually may parse inside its own `apply` and accept comment loss for that
 * one step, but the pipeline never forces it.
 *
 * Safety invariant: after stamping, the result is re-parsed and must be
 * semantically IDENTICAL to the input apart from the `schemaVersion` key. If
 * the textual edit would change anything else (pathological layouts — e.g. a
 * flow-style root mapping the line-anchored replacement can't see), the
 * use-case refuses instead of writing a corrupted manifest.
 *
 * `currentVersion`/`migrations` are constructor-injectable for tests only —
 * production callers use those defaults. Deep equality is required at every
 * construction site so this module never imports `node:util`; the CLI wires
 * `isDeepStrictEqual`. (With CURRENT = 1 and an empty registry, the walk
 * and the re-stamp arms are exercised by injecting a fake version-2
 * migration; the registry PATTERN is this PR's deliverable.)
 */
import yaml from "js-yaml";
import {
  CURRENT_MANIFEST_SCHEMA_VERSION,
  readManifestSchemaVersion,
} from "@hexagen/project-configuration";

/** Deep equality used by the stamp-only invariant. */
export type DeepEqual = (left: unknown, right: unknown) => boolean;

export interface ManifestMigration {
  /** The schemaVersion this migration upgrades TO (applied when stamped version < toVersion). */
  readonly toVersion: number;
  /** One line for the CLI report, e.g. "rename workspace_template → workspaceTemplate". */
  readonly description: string;
  /** Text-to-text so YAML comments survive; parse inside only if unavoidable. */
  readonly apply: (content: string) => string;
}

/**
 * Registered key migrations, ascending by `toVersion`. Intentionally EMPTY at
 * schema version 1 — the registry pattern is the deliverable: a future key
 * rename registers `{ toVersion: 2, description, apply }` here and
 * `hexagen manifest migrate` walks every manifest from its stamped version
 * through each step in order.
 */
export const MANIFEST_MIGRATIONS: readonly ManifestMigration[] = [];

export interface MigrateManifestResult {
  /** The migrated manifest text (byte-identical to input when `changed` is false). */
  content: string;
  /** Stamped version found in the input; `undefined` = legacy (no stamp). */
  fromVersion: number | undefined;
  toVersion: number;
  /** Descriptions of the registered migrations that ran, in order. */
  applied: string[];
  changed: boolean;
}

export class MigrateManifestUseCase {
  constructor(
    private readonly deepEqual: DeepEqual,
    private readonly currentVersion: number = CURRENT_MANIFEST_SCHEMA_VERSION,
    private readonly migrations: readonly ManifestMigration[] = MANIFEST_MIGRATIONS,
  ) {}

  execute(content: string): MigrateManifestResult {
    const parsed = yaml.load(content);
    if (parsed == null) {
      throw new Error("Manifest file is empty");
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        "Manifest root must be a YAML mapping — nothing to migrate.",
      );
    }

    // Throws on a corrupted stamp; `undefined` = legacy.
    const fromVersion = readManifestSchemaVersion(parsed);
    if (fromVersion !== undefined && fromVersion > this.currentVersion) {
      // Migration only goes FORWARD: a manifest from a newer toolchain needs
      // a newer CLI, never a downgrade-rewrite.
      throw new Error(
        `Manifest schemaVersion ${fromVersion} is newer than this toolchain supports (reads ≤ ${this.currentVersion}). ` +
          `Migration only goes forward — upgrade @hexagen-monaco/sync instead.`,
      );
    }

    // Walk the registry: every step strictly past the stamped version, up to
    // and including the current one, ascending.
    const steps = [...this.migrations]
      .filter(
        (m) =>
          m.toVersion > (fromVersion ?? 0) &&
          m.toVersion <= this.currentVersion,
      )
      .sort((a, b) => a.toVersion - b.toVersion);

    let migrated = content;
    const applied: string[] = [];
    for (const step of steps) {
      migrated = step.apply(migrated);
      applied.push(`v${step.toVersion}: ${step.description}`);
    }

    const stamped = this.stamp(migrated, fromVersion);
    this.assertStampOnlyAddedTheVersion(migrated, stamped);

    return {
      content: stamped,
      fromVersion,
      toVersion: this.currentVersion,
      applied,
      changed: stamped !== content,
    };
  }

  /**
   * Textually stamp `schemaVersion: <current>` — replace an existing
   * top-level stamp line in place, or insert one above the first content
   * line. YAML nesting is indentation, so a top-level key is exactly a
   * column-0 `schemaVersion:` line; comments (`# …`) and the document-start
   * marker (`---`) never match it.
   */
  private stamp(content: string, fromVersion: number | undefined): string {
    const stampLine = `schemaVersion: ${this.currentVersion}`;
    if (fromVersion === this.currentVersion) return content;
    if (fromVersion !== undefined) {
      return content.replace(/^schemaVersion:[^\n]*$/m, stampLine);
    }
    // Legacy manifest: insert above the first line that is content — not
    // blank, not a comment, not `---`. The split-emitted header block (and
    // any hand-written preamble) stays untouched above the stamp. A first
    // content line always exists: an all-comment document parses to null and
    // was rejected above.
    const lines = content.split("\n");
    const firstContent = lines.findIndex(
      (line) =>
        line.trim() !== "" &&
        !line.trimStart().startsWith("#") &&
        line.trim() !== "---",
    );
    lines.splice(firstContent, 0, stampLine);
    return lines.join("\n");
  }

  /**
   * The refusal that makes the textual edit safe: re-parse and require the
   * result to be the input plus (only) the current `schemaVersion`. A result
   * that no longer parses at all (e.g. a stamp inserted above a flow-style
   * root mapping) is the same failure, not a parser stack trace.
   */
  private assertStampOnlyAddedTheVersion(before: string, after: string): void {
    let stampedCleanly = false;
    try {
      const reparsed = yaml.load(after);
      stampedCleanly =
        readManifestSchemaVersion(reparsed) === this.currentVersion &&
        this.deepEqual(
          {
            ...(yaml.load(before) as object),
            schemaVersion: this.currentVersion,
          },
          reparsed,
        );
    } catch {
      // fall through to the refusal
    }
    if (!stampedCleanly) {
      throw new Error(
        `Could not stamp schemaVersion ${this.currentVersion} without altering the manifest ` +
          `(unsupported YAML layout — e.g. a flow-style root mapping). ` +
          `Add \`schemaVersion: ${this.currentVersion}\` as a top-level key by hand.`,
      );
    }
  }
}
