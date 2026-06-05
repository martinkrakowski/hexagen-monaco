import type {
  TemplateQuestion,
  ManifestOutput,
  OutputCondition,
} from "./question.js";

/**
 * Architectural scope an add-on attaches to in the visualizer
 * (see docs/planning/hydrate-visualizer-with-addons.md):
 * - `context` — a context-level adapter (joins a compass adapter slot)
 * - `shared`  — a shared-kernel domain primitive
 * - `project` — an infra cross-cutting concern (rendered in the platform zone)
 */
export type AddOnScope = "context" | "shared" | "project";

export interface TemplateManifest {
  /** Unique kebab-case identifier, e.g. "rate-limiting" */
  id: string;
  /** Human-readable name */
  name: string;
  description: string;
  version: string;
  /** IDs of templates that must be applied before this one */
  requires: string[];
  /**
   * IDs of templates that cannot coexist with this one. Conditional
   * coupling (a template that conflicts with others only under certain
   * answers) is expressed by splitting the template into a base and an
   * addon — see supabase / supabase-auth as the canonical example.
   */
  conflicts: string[];
  questions: TemplateQuestion[];
  /** Env var names this template introduces (for validate command) */
  envVars: string[];
  /**
   * Files (relative to the target project) this template will write. Each entry
   * is a plain path (always emitted) or a path gated on an answer via `when`.
   */
  outputs: ManifestOutput[];
  /** Post-install checklist items shown after successful apply */
  checklist: string[];
  /** Suggested git branch for implementation work */
  branch?: string;
  /**
   * Visualizer mapping (docs/planning/hydrate-visualizer-with-addons.md): the
   * capability this add-on provides (e.g. "messaging.out-adapter") and the
   * architectural scope it attaches to. Authoritative join data for the canvas —
   * never path-inferred. Optional, but set together (the join needs both).
   */
  provides?: string;
  scope?: AddOnScope;
}

export function validateManifest(raw: unknown): TemplateManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Template manifest must be a JSON object");
  }
  const m = raw as Record<string, unknown>;

  const required = ["id", "name", "description", "version"] as const;
  for (const field of required) {
    if (typeof m[field] !== "string" || !m[field]) {
      throw new Error(
        `Template manifest missing required string field: ${field}`,
      );
    }
  }

  const questions = validatedQuestions(m.questions);
  const questionTypes = new Map(questions.map((q) => [q.id, q.type]));

  return {
    id: m.id as string,
    name: m.name as string,
    description: m.description as string,
    version: m.version as string,
    requires: validatedStringArray(m.requires, "requires"),
    conflicts: validatedStringArray(m.conflicts, "conflicts"),
    questions,
    envVars: validatedStringArray(m.envVars, "envVars"),
    outputs: validatedOutputs(m.outputs, questionTypes),
    checklist: validatedStringArray(m.checklist, "checklist"),
    branch: typeof m.branch === "string" ? m.branch : undefined,
    ...validatedMapping(m),
  };
}

/**
 * Optional visualizer mapping (`provides` + `scope`). The two are a pair — the
 * canvas join needs both — so a half-specified manifest fails fast rather than
 * silently half-annotating. Absent on most templates (no visualizer mapping).
 */
function validatedMapping(m: Record<string, unknown>): {
  provides?: string;
  scope?: AddOnScope;
} {
  const { provides, scope } = m;
  if (
    provides !== undefined &&
    (typeof provides !== "string" || !provides.trim())
  ) {
    throw new Error(
      "Template manifest field 'provides' must be a non-empty string",
    );
  }
  const scopes: readonly AddOnScope[] = ["context", "shared", "project"];
  if (
    scope !== undefined &&
    !(typeof scope === "string" && scopes.includes(scope as AddOnScope))
  ) {
    throw new Error(
      "Template manifest field 'scope' must be one of: context, shared, project",
    );
  }
  // `provides` and `scope` are a pair — the visualizer join needs both.
  if ((provides === undefined) !== (scope === undefined)) {
    throw new Error(
      "Template manifest fields 'provides' and 'scope' must be set together",
    );
  }
  return {
    // Trimmed so a padded capability key can't silently miss the canvas join.
    provides: provides === undefined ? undefined : (provides as string).trim(),
    scope: scope as AddOnScope | undefined,
  };
}

function validatedStringArray(raw: unknown, field: string): string[] {
  // Absent / null → default to empty array. Anything else that isn't an
  // array (e.g. a string, a `{ id, when }` object) is a schema mistake and
  // throws so it can't silently degrade to "no entries" — which would, for
  // `conflicts`, disable conflict enforcement entirely.
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(
      `Template manifest field '${field}' must be an array of strings`,
    );
  }
  for (const el of raw) {
    if (typeof el !== "string") {
      throw new Error(
        `Template manifest field '${field}' must be an array of strings`,
      );
    }
  }
  return raw as string[];
}

function validatedOutputs(
  raw: unknown,
  questionTypes: Map<string, string>,
): ManifestOutput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o): ManifestOutput => {
    if (typeof o === "string") return o;
    if (!o || typeof o !== "object") {
      throw new Error(
        "Template manifest: each output must be a string or a { path, when } object",
      );
    }
    const obj = o as Record<string, unknown>;
    if (typeof obj.path !== "string" || !obj.path) {
      throw new Error(
        "Template manifest: a gated output must have a non-empty string 'path'",
      );
    }
    const when = obj.when as Record<string, unknown> | undefined;
    if (
      !when ||
      typeof when !== "object" ||
      typeof when.answer !== "string" ||
      !when.answer
    ) {
      throw new Error(
        `Template manifest: gated output '${obj.path}' must have a 'when' with a string 'answer'`,
      );
    }
    // The answer key must reference a declared question, so a typo or rename
    // fails fast instead of silently disabling the output (and hiding it from
    // validate). All answer keys originate from question ids.
    if (!questionTypes.has(when.answer)) {
      throw new Error(
        `Template manifest: gated output '${obj.path}' references unknown answer '${when.answer}' — it must match a question id`,
      );
    }
    const hasEquals = when.equals !== undefined;
    const hasIncludes = when.includes !== undefined;
    const hasIn = when.in !== undefined;
    // `equals`, `includes`, and `in` are mutually exclusive — allowing more than
    // one would make the gate ambiguous (the evaluator picks the first set).
    if (Number(hasEquals) + Number(hasIncludes) + Number(hasIn) > 1) {
      throw new Error(
        `Template manifest: gated output '${obj.path}' must set at most one of 'equals', 'includes', or 'in'`,
      );
    }
    if (
      hasEquals &&
      typeof when.equals !== "string" &&
      typeof when.equals !== "boolean"
    ) {
      throw new Error(
        `Template manifest: gated output '${obj.path}' 'equals' must be a string or boolean`,
      );
    }
    if (hasIncludes && (typeof when.includes !== "string" || !when.includes)) {
      throw new Error(
        `Template manifest: gated output '${obj.path}' 'includes' must be a non-empty string`,
      );
    }
    if (
      hasIn &&
      (!Array.isArray(when.in) ||
        when.in.length === 0 ||
        !when.in.every((v) => typeof v === "string" && v))
    ) {
      throw new Error(
        `Template manifest: gated output '${obj.path}' 'in' must be a non-empty array of non-empty strings`,
      );
    }
    // Operator must fit the question's type, or the gate silently never fires
    // (e.g. `in` on a boolean answer is never a string, so the file is never
    // emitted). `auto` answers are type-erased at authoring time, so skip them.
    const qType = questionTypes.get(when.answer);
    if (qType && qType !== "auto") {
      const fail = (msg: string): never => {
        throw new Error(
          `Template manifest: gated output '${obj.path}' — ${msg} (answer '${when.answer}' is '${qType}')`,
        );
      };
      if (qType === "multiselect") {
        if (hasEquals || hasIn)
          fail(
            "a multiselect answer supports only 'includes' (or a bare gate)",
          );
      } else if (qType === "boolean") {
        if (hasIncludes || hasIn)
          fail("a boolean answer supports only 'equals: true|false'");
        if (hasEquals && typeof when.equals !== "boolean")
          fail("'equals' on a boolean answer must be true or false");
      } else {
        // select | text — scalar string answers
        if (hasIncludes)
          fail("'includes' applies only to a multiselect answer");
        if (hasEquals && typeof when.equals === "boolean")
          fail("'equals' on a string answer must be a string (or use 'in')");
      }
    }
    const condition: OutputCondition = { answer: when.answer };
    if (hasEquals) condition.equals = when.equals as string | boolean;
    if (hasIncludes) condition.includes = when.includes as string;
    if (hasIn) condition.in = when.in as string[];
    return { path: obj.path, when: condition };
  });
}

function validatedQuestions(raw: unknown): TemplateQuestion[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set([
    "select",
    "multiselect",
    "text",
    "boolean",
    "auto",
  ]);
  for (const q of raw) {
    if (!q || typeof q !== "object") {
      throw new Error("Template manifest: each question must be an object");
    }
    const qObj = q as Record<string, unknown>;
    if (typeof qObj.id !== "string" || !qObj.id) {
      throw new Error(
        "Template manifest: each question must have a string 'id'",
      );
    }
    if (typeof qObj.type !== "string" || !validTypes.has(qObj.type)) {
      throw new Error(
        `Template manifest: question '${qObj.id}' has invalid type '${qObj.type}'`,
      );
    }
  }
  return raw as TemplateQuestion[];
}
