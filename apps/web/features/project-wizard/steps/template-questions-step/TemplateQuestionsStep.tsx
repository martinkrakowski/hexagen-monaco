"use client";

import { useFormContext } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

import { StepHeader } from "../StepHeader";
import { WizardFooter } from "../../WizardFooter";
import { useSelectedAddOns } from "../../contexts/SelectedAddOnsContext";
import { TEMPLATE_QUESTIONS } from "./template-questions.generated";
import type { AnswerValue, TemplateQuestion } from "./types";

interface TemplateQuestionsStepProps {
  onNext: () => void;
  onBack: () => void;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

/**
 * Per-template question collection. Walks each selected template's questions
 * (sourced from the generated TEMPLATE_QUESTIONS map, which is regenerated
 * from manifest.json files via `yarn workspace web gen:template-questions`)
 * and renders one section per template.
 *
 * Auto-typed questions are intentionally NOT rendered: the install use case
 * resolves them from the source template's answers without prompting. They
 * still appear in the Summary step with a "(derived from …)" annotation so
 * users can see what was filled in for them.
 *
 * Answers persist into ProjectConfig.addOnsAnswers via the existing
 * react-hook-form context (no parallel context). The CLI use case consumes
 * this field through its `overrideAnswers` parameter at install time.
 */
export function TemplateQuestionsStep({
  onNext,
  onBack,
  currentStep,
  totalSteps,
  title,
  description,
}: TemplateQuestionsStepProps): React.ReactElement {
  const { selectedIds } = useSelectedAddOns();
  const { register, watch, setValue } = useFormContext<ProjectConfig>();
  const answers = watch("addOnsAnswers") ?? {};

  // Visible templates: only those that actually have questions to answer
  // (filtering out auto-typed ones). A template with all-auto questions is
  // skipped entirely. If the resulting list is empty, the whole step shows
  // a friendly empty state and the user can Next through it.
  const sections = selectedIds
    .map((id) => {
      const all = TEMPLATE_QUESTIONS[id] ?? [];
      const interactive = all.filter((q) => q.type !== "auto");
      return { id, interactive };
    })
    .filter((s) => s.interactive.length > 0);

  // Gate Next on validation: required text questions must be non-empty, and
  // any text question with a validation.pattern must match. The template
  // engine validates required/pattern during *interactive* prompting but not
  // through overrideAnswers, so the wizard has to enforce it here. Silent
  // bypass would re-prompt the user at CLI install time (for required) or
  // ship an unchecked value (for pattern).
  function isAnswered(value: AnswerValue | undefined): boolean {
    if (value === undefined) return false;
    if (typeof value === "string") return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true; // boolean is always considered answered
  }

  const canProceed = sections.every(({ id, interactive }) =>
    interactive.every((q) => {
      const value = answers[id]?.[q.id];
      if (q.type === "text") {
        const resolved = typeof value === "string" ? value : (q.default ?? "");
        if (q.required && !resolved) return false;
        if (q.validation?.pattern && resolved) {
          try {
            if (!new RegExp(q.validation.pattern).test(resolved)) return false;
          } catch {
            // Malformed pattern in the manifest — don't block the user.
            return true;
          }
        }
        return true;
      }
      if (q.type === "select") {
        const resolved = typeof value === "string" ? value : q.default;
        return resolved !== undefined && resolved !== "";
      }
      if (q.type === "multiselect") {
        const resolved = Array.isArray(value) ? value : (q.default ?? []);
        // Multiselect is "answered" even when empty — manifests use it for
        // optional feature sets where [] is a legitimate choice.
        void resolved;
        return true;
      }
      // boolean: default exists, always answered.
      return isAnswered(value) || typeof q.default === "boolean";
    }),
  );

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep ?? 6}
        totalSteps={totalSteps ?? 7}
        title={title ?? "Template Questions"}
        description={
          description ??
          "Answer the questions for each selected add-on template. Auto-derived answers are filled in from your other selections and shown in the Summary step."
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-4">
        {sections.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No add-on templates need answers. Continue to review.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {sections.map(({ id, interactive }) => (
              <section
                key={id}
                aria-label={`Questions for ${id}`}
                className="rounded-lg border border-border bg-card p-4"
              >
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  {id}
                </h3>
                <div className="flex flex-col gap-3">
                  {interactive.map((q) => (
                    <QuestionField
                      key={q.id}
                      templateId={id}
                      question={q}
                      currentValue={answers[id]?.[q.id]}
                      onChange={(value) => {
                        setValue(
                          `addOnsAnswers.${id}.${q.id}` as never,
                          value as never,
                          { shouldDirty: true, shouldTouch: true },
                        );
                      }}
                      register={register}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <WizardFooter
        onBack={onBack}
        onNext={onNext}
        canProceed={canProceed}
        currentStep={currentStep ?? 6}
        totalSteps={totalSteps ?? 7}
        nextLabel="Review"
      />
    </div>
  );
}

interface QuestionFieldProps {
  templateId: string;
  question: TemplateQuestion;
  currentValue: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  register: ReturnType<typeof useFormContext<ProjectConfig>>["register"];
}

function QuestionField({
  question,
  currentValue,
  onChange,
}: QuestionFieldProps): React.ReactElement | null {
  if (question.type === "auto") return null;

  const inputId = `q-${question.id}`;
  return (
    <div className="flex flex-col gap-1">
      {/* For boolean questions the prompt is rendered inside the inner
          <label> wrapping the checkbox (below), so we suppress the outer
          header to avoid duplicating the text — screen readers would
          otherwise announce the prompt twice. */}
      {question.type !== "boolean" && (
        <label
          htmlFor={inputId}
          className="text-xs font-medium text-foreground"
        >
          {question.prompt}
          {"required" in question && question.required && (
            <span className="text-destructive" aria-hidden>
              {" "}
              *
            </span>
          )}
        </label>
      )}

      {question.type === "text" && (
        <input
          id={inputId}
          type="text"
          value={
            typeof currentValue === "string"
              ? currentValue
              : (question.default ?? "")
          }
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.default ?? ""}
          required={question.required}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}

      {question.type === "boolean" && (
        <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer">
          <input
            id={inputId}
            type="checkbox"
            checked={
              typeof currentValue === "boolean"
                ? currentValue
                : (question.default ?? false)
            }
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border border-input"
          />
          <span className="text-muted-foreground">{question.prompt}</span>
        </label>
      )}

      {question.type === "select" && (
        <select
          id={inputId}
          value={
            typeof currentValue === "string"
              ? currentValue
              : (question.default ?? question.options[0] ?? "")
          }
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {question.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {question.type === "multiselect" && (
        <div className="flex flex-col gap-1">
          {question.options.map((opt) => {
            const arrayValue = Array.isArray(currentValue)
              ? currentValue
              : (question.default ?? []);
            const checked = arrayValue.includes(opt);
            return (
              <label
                key={opt}
                className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...arrayValue, opt]
                      : arrayValue.filter((v) => v !== opt);
                    onChange(next);
                  }}
                  className="h-4 w-4 rounded border border-input"
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
