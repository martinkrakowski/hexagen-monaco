import type { TemplateQuestion, QuestionAnswer } from "../../domain/index.js";

export interface QuestionEnginePort {
  ask(question: TemplateQuestion): Promise<QuestionAnswer>;
}
