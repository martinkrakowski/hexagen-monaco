export type {
  QuestionType,
  TemplateQuestion,
  SelectQuestion,
  MultiSelectQuestion,
  TextQuestion,
  BooleanQuestion,
  AutoQuestion,
  QuestionAnswer,
  AnswerMap,
  OutputCondition,
  ManifestOutput,
} from "./question.js";

export {
  outputPath,
  isOutputEnabled,
  isTestOutput,
  matchesCondition,
} from "./output-gating.js";

export type { TemplateManifest } from "./template-manifest.js";
export { validateManifest } from "./template-manifest.js";

export type {
  TemplateInstallRecord,
  GeneratedFileRecord,
  TemplateConfig,
  TemplateConfigState,
} from "./template-config.js";
export {
  TEMPLATE_CONFIG_FILE,
  emptyConfig,
  isInstalled,
  configState,
} from "./template-config.js";

export { conflictFilePath } from "./conflict-path.js";
export { isContainedRelativePath } from "./output-path-safety.js";
