import { AddTemplateUseCase } from "../application/use-cases/add-template.use-case.js";
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
  ): Promise<MaterializeAddOnsResult> {
    const templateIds = Object.keys(addOnsAnswers);
    if (templateIds.length === 0) return { files: new Map(), warnings: [] };

    const emitter = new InMemoryFileEmitter(this.loadTemplateFile);
    const questionEngine = new DefaultingQuestionEngine();
    const useCase = new AddTemplateUseCase(
      this.registry,
      questionEngine,
      emitter,
      new InMemoryTemplateConfigStore(),
    );

    const { warnings } = await useCase.execute({
      templateIds,
      projectRoot: VIRTUAL_ROOT,
      overrideAnswers: addOnsAnswers,
      skipInstalled: false,
    });

    return {
      files: new Map(emitter.getFiles()),
      warnings: [...warnings, ...questionEngine.warnings],
    };
  }
}
