import type {
  TemplateManifest,
  TemplateConfig,
  AnswerMap,
  GeneratedFileRecord,
} from "../../domain/index.js";

export interface EmitResult {
  warnings: string[];
  generatedFiles: GeneratedFileRecord[];
}

export interface FileEmitterPort {
  emit(
    manifest: TemplateManifest,
    answers: AnswerMap,
    projectRoot: string,
    config: TemplateConfig,
  ): Promise<EmitResult>;
}
