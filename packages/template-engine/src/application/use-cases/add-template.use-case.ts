/* eslint-disable no-console */
import type {
  TemplateManifest,
  TemplateConfig,
  AnswerMap,
} from "../../domain/index.js";
import { isInstalled } from "../../domain/index.js";
import { resolveDependencies } from "../resolve-dependencies.js";
import type { TemplateRegistryPort } from "../ports/template-registry.port.js";
import type { QuestionEnginePort } from "../ports/question-engine.port.js";
import type { FileEmitterPort } from "../ports/file-emitter.port.js";
import type { TemplateConfigStorePort } from "../ports/template-config-store.port.js";

export interface AddTemplateInput {
  templateIds: string[];
  projectRoot: string;
  /** Pre-supplied answers that skip interactive prompts (used in --answers flag / CI) */
  overrideAnswers?: Record<string, AnswerMap>;
  /** Skip re-applying already-installed templates */
  skipInstalled?: boolean;
}

export interface AddTemplateResult {
  applied: string[];
  skipped: string[];
  warnings: string[];
}

export class AddTemplateUseCase {
  constructor(
    private readonly registry: TemplateRegistryPort,
    private readonly questionEngine: QuestionEnginePort,
    private readonly fileEmitter: FileEmitterPort,
    private readonly configStore: TemplateConfigStorePort,
  ) {}

  async execute(input: AddTemplateInput): Promise<AddTemplateResult> {
    const {
      templateIds,
      projectRoot,
      overrideAnswers = {},
      skipInstalled = true,
    } = input;

    const allManifests = await this.registry.loadAll();
    const manifestMap = new Map(allManifests.map((m) => [m.id, m]));

    // Resolve full dependency order
    const ordered = resolveDependencies(templateIds, manifestMap);

    const config = await this.configStore.load(projectRoot);
    const applied: string[] = [];
    const skipped: string[] = [];
    const allWarnings: string[] = [];

    for (const id of ordered) {
      if (skipInstalled && isInstalled(config, id)) {
        skipped.push(id);
        continue;
      }

      const manifest = manifestMap.get(id)!;
      const answers = await this.collectAnswers(
        manifest,
        config,
        overrideAnswers[id],
      );
      const { warnings, generatedFiles } = await this.fileEmitter.emit(
        manifest,
        answers,
        projectRoot,
        config,
      );

      allWarnings.push(...warnings);

      const record = {
        installedAt: new Date().toISOString(),
        version: manifest.version,
        answers,
        generatedFiles,
      };
      config.templates[id] = record;
      applied.push(id);

      this.printChecklist(manifest);
    }

    await this.configStore.save(projectRoot, config);

    return { applied, skipped, warnings: allWarnings };
  }

  private async collectAnswers(
    manifest: TemplateManifest,
    config: TemplateConfig,
    overrides?: AnswerMap,
  ): Promise<AnswerMap> {
    const answers: AnswerMap = {};

    for (const question of manifest.questions) {
      if (overrides && question.id in overrides) {
        answers[question.id] = overrides[question.id];
        continue;
      }

      if (question.type === "auto") {
        // Resolve from a previously installed template's answers
        const [sourceTemplate, sourceQuestion] =
          question.derivedFrom.split(".");
        const sourceRecord = config.templates[sourceTemplate];
        const derived =
          sourceRecord?.answers[sourceQuestion] ?? question.default ?? "";
        answers[question.id] = derived;
        continue;
      }

      answers[question.id] = await this.questionEngine.ask(question);
    }

    return answers;
  }

  private printChecklist(manifest: TemplateManifest): void {
    if (manifest.checklist.length === 0) return;
    console.log(`\n✅ ${manifest.name} installed\n`);
    console.log("Next steps:");
    manifest.checklist.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item}`);
    });
    console.log("");
  }
}
