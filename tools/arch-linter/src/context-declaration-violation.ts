/**
 * Registry-accuracy enforcement for `.architecture/contexts/**\/context.yaml`
 * (ADR-0057).
 *
 * ADR-0057 settled what these `layers.*` lists ARE: a **curated ownership
 * registry**, not a file inventory. That decision has two halves, and only one
 * of them is checkable — this module is that half.
 *
 *  - **Completeness is explicitly NOT required.** "The filesystem is the
 *    authoritative inventory. A port or adapter file is real because it exists
 *    and is imported, not because it is listed. An absent entry is not drift and
 *    is not a defect." So a symbol the code exports and the registry does not
 *    name produces NOTHING here. Enforcing that direction is what would generate
 *    the wall of false positives ADR-0057 rejected (~150 additions whose
 *    in/out direction is not derivable from the tree — see ADR-0048).
 *  - **Accuracy IS required.** "An entry naming no exported symbol is a defect,
 *    not a to-do. The registry's one hard invariant is accuracy: every entry must
 *    name a symbol that exists, spelled exactly as exported, attributed to the
 *    context whose package defines it."
 *
 * ADR-0057 recorded that this invariant "has no automated check; it is held by
 * review", and PR #608/#609 is the observed cost of that: a port landed, the
 * `external-integration` registry went stale in the very next PR, and nothing
 * noticed. This module is the check.
 *
 * ## What counts as the code side
 *
 * A declaration is satisfied when **some file in the declaring context exports a
 * symbol of exactly that name**. Not a filename match — filenames drift from
 * symbols (`governance-question-templates.ts` exports no
 * `GovernanceQuestionTemplates`), and a rename that ADR-0057 cares about is
 * precisely a symbol rename. The union is taken across every scanned file in the
 * context, so a port declared in `application/ports/out/x.port.ts` and re-exported
 * through three barrels counts once, and `export { Foo as Bar }` counts as `Bar`
 * — the name a consumer can actually import.
 *
 * `export *` is deliberately NOT followed. Union-over-all-files already covers
 * every symbol the context itself declares, so following star re-exports would
 * only ever add symbols owned by *other* packages — and ADR-0057 §2 is explicit
 * that ownership follows the definition site, not the re-export shim.
 *
 * ## Absent config
 *
 * Everything here is driven off `layers`, which is optional at every level. A
 * context with no `layers`, no `ports`, or no `adapters` declares nothing and
 * therefore cannot drift: the rule yields zero findings. A consumer repo with no
 * `.architecture/contexts/` directory at all never reaches this code with
 * anything to check — the merged manifest simply carries no `layers`. That is the
 * deliberate absent-config posture: **this rule can only fail a repo that made a
 * claim.** It is the opposite of the fail-closed posture the config loaders use,
 * and correctly so — a missing invariants file silently disables a rule the repo
 * asked for, whereas a missing registry is a repo that never asked.
 *
 * ## The one shape that can produce a false positive
 *
 * The code side is TypeScript exports as the project's `tsconfig` resolves them.
 * A context that declares `layers` but whose implementation the TypeScript
 * project does not cover (plain JavaScript, files excluded from the project)
 * presents an EMPTY export set, and every entry it declares then fails.
 *
 * This is deliberately NOT guarded by "skip a context with no exports": an
 * empty export set is also the true state of a context whose package holds only
 * `export {}` barrels — a frozen scaffold declaring elements that do not exist,
 * which is the single worst drift the rule exists to catch. Suppressing the
 * empty case to buy safety would put the hole exactly where the defect lives.
 * The caller's protections are structural instead: a context whose directory is
 * absent is skipped entirely, and a directory that resolved zero source files
 * aborts the whole run rather than reporting a pass.
 */

import type { SourceFile } from "ts-morph";

/**
 * Sections whose accuracy ADR-0057 §1 makes a hard invariant. These are the two
 * lists the ADR names as "the registry".
 */
export const ENFORCED_DECLARATION_SECTIONS = [
  "ports.in",
  "ports.out",
  "adapters",
] as const;

/**
 * Sibling element lists in the same files. ADR-0057 reasons only about ports and
 * adapters, so extending the hard invariant to these would decide policy the ADR
 * left open. They are collected and reported at `warn`, so the drift is visible
 * without a rule change deciding anything.
 */
export const ADVISORY_DECLARATION_SECTIONS = [
  "use_cases",
  "entities",
  "value_objects",
  "ui.components",
] as const;

export type DeclarationSection =
  | (typeof ENFORCED_DECLARATION_SECTIONS)[number]
  | (typeof ADVISORY_DECLARATION_SECTIONS)[number];

export interface DeclaredElement {
  section: DeclarationSection;
  /** The name exactly as written in the context file. */
  name: string;
}

export interface ContextDeclarationViolation {
  contextName: string;
  section: DeclarationSection;
  name: string;
  enforcement: "error" | "warn";
  /**
   * Ratchet-baseline `specifier` half: `<section>:<name>`. Deliberately not a
   * line number and not the rendered message, matching the baseline contract —
   * re-ordering a list or re-wording this diagnostic must not invalidate a key.
   */
  specifier: string;
  message: string;
}

/**
 * A bounded context as read from an untrusted, possibly hand-edited manifest.
 * Every level is optional and unknown-typed on purpose: the manifest schema is
 * `.passthrough()` and this rule must never throw on a shape it did not expect.
 */
export interface ContextDeclarationInput {
  name?: unknown;
  layers?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * One entry of a declaration list.
 *
 * Two spellings are legal (`LegacyOrNewPortSchema`): a bare string, and
 * `{ name, owner? }`. Anything else — a number, a nested list, an object with no
 * `name` — is not a declaration this rule can check, and is skipped rather than
 * reported: a malformed manifest is the schema's business, not the registry's.
 *
 * A `!` inside a name is NOT stripped. It is an LLM emission defect (a stray YAML
 * tag indicator; `manifest-violation-fixer` repairs it), so an entry carrying one
 * genuinely names no exported symbol and should fail here rather than be quietly
 * normalized into a pass.
 */
function entryName(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  const record = asRecord(value);
  const name = record?.name;
  if (typeof name === "string") {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function listAt(
  container: Record<string, unknown> | undefined,
  key: string,
): unknown[] {
  const value = container?.[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Read every declared element out of one bounded context.
 *
 * Returns `[]` for a context with no `layers` — the absent-config case, and the
 * reason a consumer repo that declares nothing can never fail this rule.
 */
export function collectDeclaredElements(
  context: ContextDeclarationInput,
): DeclaredElement[] {
  const layers = asRecord(context.layers);
  if (!layers) return [];

  const application = asRecord(layers.application);
  const ports = asRecord(application?.ports);
  const infrastructure = asRecord(layers.infrastructure);
  const domain = asRecord(layers.domain);
  const ui = asRecord(layers.ui);

  const sections: readonly [DeclarationSection, unknown[]][] = [
    ["ports.in", listAt(ports, "in")],
    ["ports.out", listAt(ports, "out")],
    ["adapters", listAt(infrastructure, "adapters")],
    ["use_cases", listAt(application, "use_cases")],
    ["entities", listAt(domain, "entities")],
    ["value_objects", listAt(domain, "value_objects")],
    ["ui.components", listAt(ui, "components")],
  ];

  const declared: DeclaredElement[] = [];
  for (const [section, items] of sections) {
    for (const item of items) {
      const name = entryName(item);
      if (name !== undefined) declared.push({ section, name });
    }
  }
  return declared;
}

/**
 * Every name this source file exports, syntactically.
 *
 * Syntactic on purpose. The CLI has already parsed the file into the shared
 * ts-morph `Project` to walk its imports; this reads declarations off that same
 * AST and never asks the type checker anything, so it adds no second parse and no
 * type resolution to a run. `getExportedDeclarations()` would be the "correct"
 * API and is the expensive one — it resolves `export *` chains through the
 * checker, which is both the cost this avoids and the semantics this rule does
 * not want (see the module note on `export *`).
 */
export function collectExportedNames(file: SourceFile): string[] {
  const names: string[] = [];
  const push = (name: string | undefined): void => {
    if (name !== undefined && name.length > 0) names.push(name);
  };

  for (const declaration of file.getInterfaces()) {
    if (declaration.isExported()) push(declaration.getName());
  }
  for (const declaration of file.getTypeAliases()) {
    if (declaration.isExported()) push(declaration.getName());
  }
  for (const declaration of file.getClasses()) {
    // `export default class {}` is anonymous — nothing to name, nothing to match.
    if (declaration.isExported()) push(declaration.getName());
  }
  for (const declaration of file.getEnums()) {
    if (declaration.isExported()) push(declaration.getName());
  }
  for (const declaration of file.getFunctions()) {
    if (declaration.isExported()) push(declaration.getName());
  }
  // Read off the STATEMENT, not the declaration: `export` is a modifier on
  // `export const a = 1, b = 2;` as a whole, and the statement node is the one
  // that carries it.
  for (const statement of file.getVariableStatements()) {
    if (!statement.isExported()) continue;
    // Covers `export const XView = () => …` — a React component or a const
    // object is a legitimate registry entry (`ModelSettingsView`).
    for (const declaration of statement.getDeclarations()) {
      push(declaration.getName());
    }
  }
  for (const exportDeclaration of file.getExportDeclarations()) {
    for (const named of exportDeclaration.getNamedExports()) {
      // The ALIAS is the importable name: `export { Foo as Bar }` exports `Bar`.
      push(named.getAliasNode()?.getText() ?? named.getNameNode().getText());
    }
  }
  return names;
}

export interface CheckContextDeclarationsInput {
  contextName: string;
  declared: readonly DeclaredElement[];
  /** Union of `collectExportedNames` over every scanned file in the context. */
  exportedNames: ReadonlySet<string>;
  /**
   * Sections held to the hard invariant. Defaults to
   * `ENFORCED_DECLARATION_SECTIONS`; everything else in `declared` is reported at
   * `warn`. Injected rather than hard-coded so widening the gate is a call-site
   * decision with a test, not an edit buried in this file.
   */
  enforcedSections?: readonly DeclarationSection[];
}

/**
 * The check: every declared element must name a symbol the context exports.
 *
 * One direction only. Nothing is reported for a symbol that is exported and not
 * declared — see the module note; that is ADR-0057's explicit non-defect.
 */
export function checkContextDeclarations({
  contextName,
  declared,
  exportedNames,
  enforcedSections = ENFORCED_DECLARATION_SECTIONS,
}: CheckContextDeclarationsInput): ContextDeclarationViolation[] {
  const enforced = new Set<DeclarationSection>(enforcedSections);
  const violations: ContextDeclarationViolation[] = [];

  for (const element of declared) {
    if (exportedNames.has(element.name)) continue;
    const enforcement = enforced.has(element.section) ? "error" : "warn";
    violations.push({
      contextName,
      section: element.section,
      name: element.name,
      enforcement,
      specifier: `${element.section}:${element.name}`,
      message:
        `Context Declaration Drift in [${contextName}]:\n` +
        `  layers.${element.section} declares '${element.name}', but no file in this context exports that symbol.\n` +
        `  ADR-0057: the registry's one hard invariant is accuracy — an entry must name a symbol that exists, spelled exactly as exported.\n` +
        `  Fix the spelling, move the entry to the context that defines the symbol, or delete the entry. Do NOT add a stub to satisfy the list.`,
    });
  }
  return violations;
}
