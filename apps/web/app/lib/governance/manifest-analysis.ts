import * as yaml from "js-yaml";

/**
 * Single source of truth for manifest-derived governance analysis.
 *
 * Before this module the `governance/status`, `governance/violations`, and
 * `governance/refresh` routes each re-parsed the manifest YAML and re-counted
 * ports/adapters their own way, with mutually divergent semantics (AUD-005):
 *   - `status` counted `application.ports.in/out` as ARRAYS (`.length`);
 *   - `violations` counted them as OBJECTS (`Object.keys().length`);
 *   - each route's YAML-parse-failure path silently returned a "healthy"
 *     result (`status: []` / `isCompliant: true`).
 *
 * This module unifies the manifest-based semantics: one port/adapter count, one
 * shadow-rule set, and a parse failure that is surfaced as an explicit error the
 * routes turn into a non-compliant / error response — never `isCompliant: true`.
 *
 * NOTE (scope): this is the CORRECTNESS half of HEX-016. The authoritative
 * `lint:arch` shell-out in `governance/refresh` is intentionally left in place;
 * the STRUCTURAL half (shell-lint / filesystem / YAML / LLM behind ports) lands
 * separately (plan item 6.3).
 */

export interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface PortAdapterStatus {
  context: string;
  ports: number;
  adapters: number;
  complete: boolean;
}

export interface GovernanceAnalysis {
  status: PortAdapterStatus[];
  violations: Violation[];
  isCompliant: boolean;
}

export type ManifestAnalysisResult =
  | ({ ok: true } & GovernanceAnalysis)
  | { ok: false; error: string };

/** Count entries whether the manifest expresses a port list as an array of
 * names or a keyed object — the routes historically disagreed on this. */
function countEntries(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize a manifest's `dependencies` field to a flat list of dependency
 * names. Dependencies may be expressed as an array of name strings, an array of
 * `{ name }` records, or a keyed object whose keys are the dependency names —
 * the same shape divergence `countEntries` already reconciles for ports. The
 * self-dependency rule must tolerate all three, or a self-referential context
 * expressed in the "wrong" shape silently passes. */
function dependencyNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((dep) =>
      typeof dep === "string"
        ? dep
        : isRecord(dep)
          ? String(dep.name ?? "")
          : "",
    );
  }
  if (isRecord(value)) return Object.keys(value);
  return [];
}

/**
 * Parse a manifest and derive its governance status + shadow-rule violations.
 * Returns `{ ok: false, error }` when the YAML cannot be parsed, does not parse
 * to an object, or has a `bounded_contexts` that is present but not a list.
 * Callers must render EVERY `ok: false` as non-compliant/error, never compliant.
 */
export function analyzeManifest(manifestYaml: string): ManifestAnalysisResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(manifestYaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Manifest YAML is not parseable: ${message}` };
  }

  // `yaml.load` returns a scalar/undefined for non-mapping input; a manifest
  // that is not an object is as unusable as one that fails to parse.
  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: "Manifest YAML did not parse to an object",
    };
  }

  const boundedContexts = parsed.bounded_contexts;
  // Absent (`undefined`/`null`, including an empty `bounded_contexts:` key) → a
  // legitimately empty, compliant manifest. This is NOT a schema failure.
  if (boundedContexts == null) {
    return { ok: true, status: [], violations: [], isCompliant: true };
  }
  // Present but not a list (a scalar, a mapping, a bare string, ...) → a
  // schema-invalid shape. The manifest parsed, but `bounded_contexts` is
  // structurally unusable (a caller cannot iterate it), so this is the very
  // false-green this module exists to kill: surface it as an explicit error and
  // never report it compliant. The routes render `ok: false` as
  // non-compliant/error, exactly as they do for the non-object root above.
  if (!Array.isArray(boundedContexts)) {
    return {
      ok: false,
      error: "Manifest field `bounded_contexts` must be a list of contexts",
    };
  }
  // A well-formed but empty context list is legitimately empty and compliant.
  if (boundedContexts.length === 0) {
    return { ok: true, status: [], violations: [], isCompliant: true };
  }

  const status: PortAdapterStatus[] = [];
  const violations: Violation[] = [];

  for (const raw of boundedContexts) {
    if (!isRecord(raw)) continue;
    const ctxName = String(raw.name ?? "");
    const layers = isRecord(raw.layers) ? raw.layers : undefined;

    const application = isRecord(layers?.application)
      ? layers?.application
      : undefined;
    const ports = isRecord(application?.ports) ? application?.ports : undefined;
    const portCount = countEntries(ports?.in) + countEntries(ports?.out);

    const domain = isRecord(layers?.domain) ? layers?.domain : undefined;
    const adapterCount = countEntries(domain?.adapters);

    status.push({
      context: ctxName,
      ports: portCount,
      adapters: adapterCount,
      complete: portCount > 0 && adapterCount >= Math.ceil(portCount / 2),
    });

    // Shadow rule: declared ports with no adapters implemented yet.
    if (portCount > 0 && adapterCount === 0) {
      violations.push({
        id: `${ctxName}-missing-adapters`,
        type: "warning",
        message: `Context "${ctxName}" has ${portCount} port(s) but no adapters implemented`,
        severity: "MEDIUM",
      });
    }

    // Shadow rule: a context that depends on itself. Ignore empty names so two
    // distinct unnamed contexts are not mislabeled as self-dependent.
    for (const depName of dependencyNames(raw.dependencies)) {
      if (depName && depName === ctxName) {
        violations.push({
          id: `${ctxName}-self-dependency`,
          type: "error",
          message: `Context "${ctxName}" depends on itself`,
          severity: "HIGH",
        });
      }
    }
  }

  return {
    ok: true,
    status,
    violations,
    isCompliant: violations.every((v) => v.type !== "error"),
  };
}
