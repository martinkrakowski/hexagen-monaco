import { ManifestSchema } from "@hexagen/project-configuration";
import type { ManifestOutput } from "./draft-to-manifest.transform";

/**
 * Outcome of the Stage-5 schema gate (see `enforceManifestSchema`).
 */
export interface SchemaGateResult {
  /** One line per drop/coercion the gate made — surfaced as adjustments. */
  advisories: string[];
  /**
   * Zod issues that remain AFTER sanitization, formatted as `path: message`.
   * Should be empty; a non-empty list means the accept screen's strict parse
   * will reject this manifest, so callers must surface it loudly.
   */
  residualIssues: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Compact single-line preview of a dropped entry for the advisory text. */
function previewEntry(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json.slice(0, 80);
  } catch {
    return String(value);
  }
}

/**
 * Make the assembled manifest object satisfy the SAME `ManifestSchema` the
 * accept screen parses it with (`parseManifestToWizardData` →
 * `ManifestSchema.strict().safeParse`) — the invariant is "a manifest this
 * pipeline returns always parses on accept".
 *
 * Why this exists: `apps`, `context_mappings`, and the stage-1 domain names are
 * LLM-derived (loose-spec conversion / Stage-7 repair ops) and reach the
 * rendered YAML VERBATIM — the pipeline's own Stage 6 reviews DDD rules, not
 * schema shape. A single app entry without a `name`, a mapping missing an
 * endpoint, or a nameless aggregate (`- null` in `entities`) fails the strict
 * parse and bricks the whole run behind a generic "could not be parsed" at the
 * very last click (the alvaro-ai import failure).
 *
 * Mutates `manifest` in place (like the other Stage-5 helpers) so the caller's
 * `parsedObject` and the rendered YAML cannot disagree. Every change is
 * reported, never silent. Ends with a full `ManifestSchema.safeParse`
 * verification; anything it still rejects is returned in `residualIssues`.
 */
export function enforceManifestSchema(
  manifest: ManifestOutput,
): SchemaGateResult {
  const advisories: string[] = [];

  // apps: the schema requires every entry to be an object with a string `name`
  // (unknown extra keys are stripped by AppSchema, so those are safe to keep).
  if (Array.isArray(manifest.apps)) {
    const kept: unknown[] = [];
    for (const app of manifest.apps) {
      if (isNonEmptyString(app)) {
        kept.push({ name: app.trim() });
        advisories.push(
          `Coerced app entry '${app.trim()}' to an object form — the manifest schema requires app entries to be objects with a 'name'.`,
        );
      } else if (
        app !== null &&
        typeof app === "object" &&
        isNonEmptyString((app as { name?: unknown }).name)
      ) {
        kept.push(app);
      } else {
        advisories.push(
          `Dropped an app entry without a usable name (${previewEntry(app)}) — the manifest schema requires every app to carry a string 'name'.`,
        );
      }
    }
    manifest.apps = kept;
  }

  // context_mappings: `upstream` and `downstream` are required strings.
  if (Array.isArray(manifest.context_mappings)) {
    const kept: NonNullable<ManifestOutput["context_mappings"]> = [];
    for (const mapping of manifest.context_mappings) {
      if (
        mapping !== null &&
        typeof mapping === "object" &&
        isNonEmptyString(mapping.upstream) &&
        isNonEmptyString(mapping.downstream)
      ) {
        kept.push(mapping);
      } else {
        advisories.push(
          `Dropped a context mapping missing an upstream/downstream endpoint (${previewEntry(mapping)}).`,
        );
      }
    }
    manifest.context_mappings = kept;
  }

  // Per-context string lists: a nameless aggregate/value object upstream turns
  // into `- null` in the rendered YAML, which the schema rejects. Ports are
  // rendered from typed PortDefinitions so they're normally clean — filtered
  // here defensively since a Stage-7 repair op can write these slots too.
  for (const bc of manifest.bounded_contexts ?? []) {
    const layers = bc.layers as
      | {
          domain?: Record<string, unknown>;
          application?: { ports?: { in?: unknown[]; out?: unknown[] } };
        }
      | undefined;
    const filterStrings = (slot: string, values: unknown): unknown[] | null => {
      if (!Array.isArray(values)) return null;
      const strings = values.filter(isNonEmptyString);
      if (strings.length !== values.length) {
        advisories.push(
          `Dropped ${values.length - strings.length} unnamed ${slot} entr${values.length - strings.length === 1 ? "y" : "ies"} in context '${bc.name}' — the manifest schema requires string names.`,
        );
      }
      return strings;
    };

    const domain = layers?.domain;
    if (domain) {
      for (const key of ["entities", "value_objects"] as const) {
        const filtered = filterStrings(key.replace("_", " "), domain[key]);
        if (filtered) domain[key] = filtered;
      }
    }
    const ports = layers?.application?.ports;
    if (ports) {
      for (const key of ["in", "out"] as const) {
        const filtered = filterStrings(`${key}-port`, ports[key]);
        if (filtered) ports[key] = filtered as string[];
      }
    }
  }

  // Final verification with the accept screen's exact schema. `undefined`
  // object values here round-trip to ABSENT keys in YAML, and both pass the
  // optional fields, so parsing the object is equivalent to parsing the
  // rendered document.
  const result = ManifestSchema.safeParse(manifest);
  const residualIssues = result.success
    ? []
    : result.error.errors.map((issue) =>
        issue.path.length > 0
          ? `${issue.path.join(".")}: ${issue.message}`
          : issue.message,
      );

  return { advisories, residualIssues };
}
