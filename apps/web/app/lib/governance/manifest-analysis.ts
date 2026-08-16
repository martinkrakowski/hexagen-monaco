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
 * NOTE (scope): this is the CORRECTNESS half of HEX-016 (plan item 1.6). The
 * STRUCTURAL half (item 6.3) has since put the `lint:arch` shell-out and the
 * LLM wiring behind `ManifestLintPort` / `SuggestionPort` — see `./ports.ts`.
 * YAML parsing deliberately did NOT become a port: parsing a string the caller
 * already holds is a pure function, and the audit refuted the codec-port
 * recommendation for exactly this `js-yaml` usage (HEX-026). Isolating it here,
 * as a function, IS the structural answer for the YAML concern.
 *
 * NOTE (key paths): every manifest key this module reads is declared once in
 * {@link MANIFEST_KEY_PATHS} and read through {@link readPath}. Nothing here
 * reaches into a parsed manifest by hand. That is deliberate: the module
 * previously read adapters from `layers.domain.adapters` and dependencies from
 * `dependencies`, and NEITHER key exists in the manifest schema
 * (`BoundedContextSchema` puts adapters under `layers.infrastructure` and names
 * the dependency list `depends_on`) or in any real `.architecture` context file.
 * The result was an adapter count pinned at `0`, `complete` pinned at `false`,
 * and an unsilenceable "has N port(s) but no adapters implemented" warning on
 * every context with declared ports. Routing all reads through one declared set
 * lets a test assert that set against the repo's own manifest, so the next
 * phantom key fails a test instead of shipping as a permanently-red governance
 * panel. See `__tests__/manifest-analysis.test.ts`.
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

/**
 * The manifest key paths this module reads, relative to one element of
 * `bounded_contexts`. These MUST match `BoundedContextSchema` in
 * `@hexagen/project-configuration` — the shape every real `context.yaml` and
 * every `wizardToManifest` projection actually emits.
 *
 * Exported so the test suite can assert each path resolves against the repo's
 * OWN merged manifest. A path that no real manifest provides is a permanently
 * dead read, which is exactly the defect this constant exists to prevent.
 */
export const CONTEXT_KEY_PATHS = {
  name: ["name"],
  portsIn: ["layers", "application", "ports", "in"],
  portsOut: ["layers", "application", "ports", "out"],
  adapters: ["layers", "infrastructure", "adapters"],
  dependsOn: ["depends_on"],
} as const;

/** The root-level key holding the context list. */
export const BOUNDED_CONTEXTS_KEY = "bounded_contexts";

/**
 * Every manifest key path this module reads, as dotted paths rooted at the
 * manifest document. The first segment is always {@link BOUNDED_CONTEXTS_KEY};
 * the rest address one context element.
 */
export const MANIFEST_KEY_PATHS: readonly string[] = [
  BOUNDED_CONTEXTS_KEY,
  ...Object.values(CONTEXT_KEY_PATHS).map((path) =>
    [BOUNDED_CONTEXTS_KEY, ...path].join("."),
  ),
];

/**
 * Resolve a declared key path against a parsed manifest node, narrowing at each
 * step. Returns `undefined` the moment a segment is missing or the node stops
 * being a mapping — the same tolerance the hand-written optional chains had,
 * minus the ability to spell a key that does not exist.
 */
function readPath(node: unknown, path: readonly string[]): unknown {
  let current: unknown = node;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Normalize a manifest's `depends_on` field to a flat list of dependency
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

  const boundedContexts = parsed[BOUNDED_CONTEXTS_KEY];
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
  // Present, a non-empty list, but with element(s) that are not context
  // mappings (e.g. `bounded_contexts: [alpha, beta]`, a list of bare scalars).
  // The per-context loop below skips non-record elements for type-narrowing, so
  // an all-scalar list would fall straight through to an empty, "compliant"
  // result — the same false green a non-list `bounded_contexts` produces. Reject
  // the shape explicitly so a caller can never mistake dropped elements for a
  // clean, empty manifest.
  if (boundedContexts.some((ctx) => !isRecord(ctx))) {
    return {
      ok: false,
      error:
        "Manifest field `bounded_contexts` must be a list of context mappings",
    };
  }

  const status: PortAdapterStatus[] = [];
  const violations: Violation[] = [];

  // Index-keyed ids: the governance UI uses `violation.id` as a React list key
  // (ViolationsSection / AIGovernancePanel), so two contexts that share a name —
  // or are both unnamed — must not collide on a single id. The element index is
  // unique per context and disambiguates them.
  for (const [index, raw] of boundedContexts.entries()) {
    if (!isRecord(raw)) continue;
    const ctxName = String(readPath(raw, CONTEXT_KEY_PATHS.name) ?? "");

    const portCount =
      countEntries(readPath(raw, CONTEXT_KEY_PATHS.portsIn)) +
      countEntries(readPath(raw, CONTEXT_KEY_PATHS.portsOut));

    // Adapters live under `layers.infrastructure`, per `BoundedContextSchema`.
    // Reading them from `layers.domain` (as this module did) pinned the count at
    // 0 for every manifest ever written and made the shadow rule below fire on
    // every context with ports.
    const adapterCount = countEntries(
      readPath(raw, CONTEXT_KEY_PATHS.adapters),
    );

    status.push({
      context: ctxName,
      ports: portCount,
      adapters: adapterCount,
      complete: portCount > 0 && adapterCount >= Math.ceil(portCount / 2),
    });

    // Shadow rule: declared ports with no adapters implemented yet.
    if (portCount > 0 && adapterCount === 0) {
      violations.push({
        id: `${ctxName || "unnamed"}-${index}-missing-adapters`,
        type: "warning",
        message: `Context "${ctxName}" has ${portCount} port(s) but no adapters implemented`,
        severity: "MEDIUM",
      });
    }

    // Shadow rule: a context that depends on itself. Ignore empty names so two
    // distinct unnamed contexts are not mislabeled as self-dependent. Emit at
    // most ONE violation per context even if it self-lists more than once, so a
    // repeated self-reference cannot mint a duplicate id.
    if (
      dependencyNames(readPath(raw, CONTEXT_KEY_PATHS.dependsOn)).some(
        (dep) => dep && dep === ctxName,
      )
    ) {
      violations.push({
        id: `${ctxName || "unnamed"}-${index}-self-dependency`,
        type: "error",
        message: `Context "${ctxName}" depends on itself`,
        severity: "HIGH",
      });
    }
  }

  return {
    ok: true,
    status,
    violations,
    isCompliant: violations.every((v) => v.type !== "error"),
  };
}
