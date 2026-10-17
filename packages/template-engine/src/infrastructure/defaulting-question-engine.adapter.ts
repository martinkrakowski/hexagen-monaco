import { interpolate } from "@hexagen/shared";
import type { QuestionEnginePort } from "../application/ports/question-engine.port.js";
import type { TemplateQuestion, QuestionAnswer } from "../domain/index.js";

/**
 * Narrow advice callback for defaulted `select` questions (Jev U-C). It never
 * decides: the default still applies and the answer value never changes — a
 * defined, in-range result only annotates the question's existing warning.
 * Declared here, beside the question engine, so template-engine keeps its
 * dependency on `@hexagen/shared` only (never the decision-advice port).
 */
export type SelectSuggestion = (input: {
  projectName: string;
  prompt: string;
  options: readonly string[];
}) => Promise<{ index: number; confidence: number } | undefined>;

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

  constructor(
    private readonly reservedVars: Record<string, string> = {},
    private readonly suggest?: SelectSuggestion,
  ) {}

  async ask(question: TemplateQuestion): Promise<QuestionAnswer> {
    this.warnings.push(
      `No answer supplied for '${question.id}'; used its default.`,
    );
    if (question.type === "boolean") return question.default ?? false;
    if (question.type === "multiselect") return question.default ?? [];
    if (question.type === "select") {
      const answer = this.resolve(
        question.default ?? question.options[0] ?? "",
      );
      await this.appendSuggestion(question);
      return answer;
    }
    if (question.type === "text") return this.resolve(question.default ?? "");
    // "auto" — normally resolved by AddTemplateUseCase before ask() is reached.
    return this.resolve(question.default ?? "");
  }

  /**
   * Ask the optional suggestion callback for a defaulted `select` and annotate
   * the warning that was just pushed for this question. A rejection, an
   * undefined result or an out-of-range index leaves the warning exactly as it
   * was; the default still applies and the answer value never changes.
   */
  private async appendSuggestion(
    question: Extract<TemplateQuestion, { type: "select" }>,
  ): Promise<void> {
    if (!this.suggest) return;
    let result: { index: number; confidence: number } | undefined;
    try {
      result = await this.suggest({
        projectName: this.reservedVars.projectName ?? "",
        prompt: question.prompt,
        options: question.options,
      });
    } catch {
      return;
    }
    if (!result) return;
    const option = question.options[result.index];
    if (option === undefined) return;
    const last = this.warnings.length - 1;
    this.warnings[last] =
      `${this.warnings[last]} suggested: ${option} (${result.confidence.toFixed(2)})`;
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
