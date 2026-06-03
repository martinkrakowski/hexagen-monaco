import type { QuestionEnginePort } from "../application/ports/question-engine.port.js";
import type { TemplateQuestion, QuestionAnswer } from "../domain/index.js";

/**
 * A QuestionEnginePort for non-interactive runs: returns each question's
 * declared default. In materialization, every selected template's answers are
 * pre-supplied via overrideAnswers, so ask() only fires for a question with no
 * supplied answer (e.g. a pulled-in required template, or a gap in the wizard's
 * answers). Each such call is recorded in `warnings` so the caller can surface it.
 */
export class DefaultingQuestionEngine implements QuestionEnginePort {
  readonly warnings: string[] = [];

  async ask(question: TemplateQuestion): Promise<QuestionAnswer> {
    this.warnings.push(
      `No answer supplied for '${question.id}'; used its default.`,
    );
    if (question.type === "boolean") return question.default ?? false;
    if (question.type === "multiselect") return question.default ?? [];
    if (question.type === "select")
      return question.default ?? question.options[0] ?? "";
    if (question.type === "text") return question.default ?? "";
    // "auto" — normally resolved by AddTemplateUseCase before ask() is reached.
    return question.default ?? "";
  }
}
