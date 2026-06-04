/** A single add-on answer: a select/text value, a boolean, or a multiselect list. */
export type AddOnAnswerValue = string | boolean | string[];

/**
 * Per-template answers gathered by the wizard: `templateId → (questionId → value)`.
 * Structurally identical to the wizard's `addOnsAnswers` and the template engine's
 * `Record<string, AnswerMap>`, declared here so this layer stays free of any
 * `@hexagen/template-engine` dependency (application is ports-only).
 */
export type AddOnAnswers = Record<string, Record<string, AddOnAnswerValue>>;

export interface MaterializeResult {
  /** Emitted add-on files: path relative to the project root → content. */
  files: Map<string, string>;
  /** Non-fatal notices (e.g. an add-on overrode another add-on's file). */
  warnings: string[];
  /**
   * Selection problems — an unknown, conflicting, or cyclic add-on selection.
   * `materialize()` **never throws** for these; it returns them here (with no
   * files) so the caller can surface a validation response and still ship the
   * core project. Empty on success.
   */
  errors: string[];
}

/**
 * Out-port for materializing the wizard's selected add-on templates into an
 * in-memory file map, with **no filesystem access** of its own. The composition
 * root adapts `@hexagen/template-engine`'s `createInMemoryMaterializer()` to this
 * port; `GenerateProjectUseCase` merges the result into the generated project
 * (template-overrides-core precedence).
 */
/** Run-level options threaded from the generation context into materialization. */
export interface MaterializeOptions {
  /**
   * The resolved project name (post-manifest-assembly), exposed to every template
   * as the reserved `{projectName}` interpolation var so a default like
   * `"{projectName}"` resolves to the same string used in generated file content.
   */
  projectName?: string;
  /** Emit `*.test.*` / `*.spec.*` scaffolds (the `--with-tests` gate). Default false. */
  withTests?: boolean;
}

export interface AddOnMaterializerPort {
  materialize(
    addOnsAnswers: AddOnAnswers,
    options?: MaterializeOptions,
  ): Promise<MaterializeResult>;
}
