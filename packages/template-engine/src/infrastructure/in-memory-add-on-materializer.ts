import { AddTemplateUseCase } from "../application/use-cases/add-template.use-case.js";
import {
  CyclicDependencyError,
  MissingTemplateError,
  ConflictError,
} from "../application/resolve-dependencies.js";
import type { TemplateRegistryPort } from "../application/ports/template-registry.port.js";
import type { AnswerMap } from "../domain/index.js";
import { InMemoryFileEmitter } from "./in-memory-file-emitter.adapter.js";
import type { TemplateFileLoader } from "./in-memory-file-emitter.adapter.js";
import { DefaultingQuestionEngine } from "./defaulting-question-engine.adapter.js";
import { InMemoryTemplateConfigStore } from "./in-memory-template-config-store.adapter.js";

// The in-memory adapters ignore the project root (no disk); this is a label only.
const VIRTUAL_ROOT = "/__hexagen_virtual__";

export interface MaterializeAddOnsResult {
  /** Emitted files: path (relative to the project root) → content. */
  files: Map<string, string>;
  warnings: string[];
  /**
   * User-input selection problems — an unknown, conflicting, or cyclic add-on
   * selection. materialize() **never throws** for these; it returns them here
   * (with no files) so the caller can surface a validation response rather than
   * crash the generation. Empty on success.
   */
  errors: string[];
}

/** Run-level materialization options: reserved vars + the test-scaffolding gate. */
export interface MaterializeAddOnsOptions {
  /** Project name, exposed to every template as the reserved `{projectName}` var. */
  projectName?: string;
  /** Emit `*.test.*` / `*.spec.*` scaffolds (the `--with-tests` gate). Default false. */
  withTests?: boolean;
}

/**
 * Materializes selected add-on templates into an in-memory file map — the
 * headless counterpart to the CLI's on-disk install. Resolves `requires` /
 * `conflicts` ordering and applies the wizard's pre-supplied answers via
 * AddTemplateUseCase, then returns the emitted content for the caller to merge
 * into the core-generated files (template-overrides-core precedence).
 *
 * Stateless across calls: a fresh emitter / config store / question engine is
 * created per materialize(), so one instance is safe to reuse across requests.
 */
export class InMemoryAddOnMaterializer {
  constructor(
    private readonly registry: TemplateRegistryPort,
    private readonly loadTemplateFile: TemplateFileLoader,
  ) {}

  async materialize(
    addOnsAnswers: Record<string, AnswerMap>,
    options: MaterializeAddOnsOptions = {},
  ): Promise<MaterializeAddOnsResult> {
    const templateIds = Object.keys(addOnsAnswers);
    if (templateIds.length === 0) {
      return { files: new Map(), warnings: [], errors: [] };
    }

    // Reserved interpolation vars available to every template (file content +
    // string question defaults), e.g. {projectName}.
    const reservedVars: Record<string, string> = {};
    if (options.projectName) reservedVars.projectName = options.projectName;

    const emitter = new InMemoryFileEmitter(this.loadTemplateFile, {
      reservedVars,
      withTests: options.withTests ?? false,
    });
    const questionEngine = new DefaultingQuestionEngine(reservedVars);
    const useCase = new AddTemplateUseCase(
      this.registry,
      questionEngine,
      emitter,
      new InMemoryTemplateConfigStore(),
      true, // quiet: a headless run must not print install checklists to stdout
    );

    try {
      const { warnings } = await useCase.execute({
        templateIds,
        projectRoot: VIRTUAL_ROOT,
        overrideAnswers: addOnsAnswers,
        skipInstalled: false,
      });
      return {
        files: new Map(emitter.getFiles()),
        warnings: [...warnings, ...questionEngine.warnings],
        errors: [],
      };
    } catch (err) {
      // Invalid user selections (unknown id / conflict / cycle) are surfaced as
      // errors, not thrown — the caller turns them into a validation response.
      // Anything unexpected still propagates.
      if (
        err instanceof MissingTemplateError ||
        err instanceof ConflictError ||
        err instanceof CyclicDependencyError
      ) {
        return {
          files: new Map(),
          warnings: [...questionEngine.warnings],
          errors: [err.message],
        };
      }
      throw err;
    }
  }
}
