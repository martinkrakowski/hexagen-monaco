import { interpolate } from "@hexagen/shared";
import type { QuestionEnginePort } from "../application/ports/question-engine.port.js";
import type { TemplateQuestion, QuestionAnswer } from "../domain/index.js";

/**
 * A QuestionEnginePort for non-interactive runs: returns each question's
 * declared default. In materialization, every selected template's answers are
 * pre-supplied via overrideAnswers, so ask() only fires for a question with no
 * supplied answer (e.g. a pulled-in required template, or a gap in the wizard's
 * answers). Each such call is recorded in `warnings` so the caller can surface it.
 *
 * String defaults are interpolated against the reserved vars (e.g. projectName),
 * so a question default like `"{projectName}"` resolves at materialization rather
 * than reaching a file verbatim.
 */
export class DefaultingQuestionEngine implements QuestionEnginePort {
  readonly warnings: string[] = [];

  constructor(private readonly reservedVars: Record<string, string> = {}) {}

  async ask(question: TemplateQuestion): Promise<QuestionAnswer> {
    this.warnings.push(
      `No answer supplied for '${question.id}'; used its default.`,
    );
    if (question.type === "boolean") return question.default ?? false;
    if (question.type === "multiselect") return question.default ?? [];
    if (question.type === "select")
      return this.resolve(question.default ?? question.options[0] ?? "");
    if (question.type === "text") return this.resolve(question.default ?? "");
    // "auto" — normally resolved by AddTemplateUseCase before ask() is reached.
    return this.resolve(question.default ?? "");
  }

  /**
   * Interpolate a string default against the reserved vars (e.g. `{projectName}`);
   * non-string defaults (boolean / string[]) pass through untouched.
   */
  private resolve(value: QuestionAnswer): QuestionAnswer {
    return typeof value === "string"
      ? interpolate(value, this.reservedVars).output
      : value;
  }
}
