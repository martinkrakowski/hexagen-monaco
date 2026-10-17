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
  /** Index of the default that applies (`options.indexOf(question.default ?? options[0])`). */
  defaultIndex: number;
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
    private readonly suggestTimeoutMs = 3000,
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
    const result = await this.askWithDeadline(question);
    if (!isValidSuggestion(result, question.options.length)) return;
    const option = question.options[result.index];
    const last = this.warnings.length - 1;
    this.warnings[last] =
      `${this.warnings[last]} suggested: ${option} (${result.confidence.toFixed(2)})`;
  }

  /**
   * The callback raced against a deadline: a rejection, a throw or a callback
   * that has not settled in time is no suggestion, never a hang or an error.
   */
  private async askWithDeadline(
    question: Extract<TemplateQuestion, { type: "select" }>,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), this.suggestTimeoutMs);
    });
    // The callback's own promise carries its catch, so a rejection that lands
    // after the deadline has already won is handled, never unhandled.
    const advice = Promise.resolve()
      .then(() =>
        this.suggest?.({
          projectName: this.reservedVars.projectName ?? "",
          prompt: question.prompt,
          options: question.options,
          defaultIndex: question.options.indexOf(
            question.default ?? question.options[0] ?? "",
          ),
        }),
      )
      .catch(() => undefined);
    try {
      return await Promise.race([advice, deadline]);
    } finally {
      clearTimeout(timer);
    }
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

/** A suggestion is used only when its index is an in-range integer and its confidence a number in 0..1. */
function isValidSuggestion(
  value: unknown,
  optionCount: number,
): value is { index: number; confidence: number } {
  if (typeof value !== "object" || value === null) return false;
  const { index, confidence } = value as Record<string, unknown>;
  return (
    Number.isInteger(index) &&
    (index as number) >= 0 &&
    (index as number) < optionCount &&
    typeof confidence === "number" &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
  );
}
