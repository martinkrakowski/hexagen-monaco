"use client";

import { useFormContext } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

import { useSelectedAddOns } from "../../contexts/SelectedAddOnsContext";
import { TEMPLATE_CATALOG } from "../add-ons-step/template-catalog";
import { TEMPLATE_QUESTIONS } from "../template-questions-step";
import { SummarySection } from "./SummarySection";

export function AddOnsSummary() {
  const { selectedIds } = useSelectedAddOns();
  const { watch } = useFormContext<ProjectConfig>();
  const addOnsAnswers = watch("addOnsAnswers") ?? {};

  if (selectedIds.length === 0) return null;

  const entries = selectedIds
    .map((id) => TEMPLATE_CATALOG.find((e) => e.id === id))
    .filter(Boolean);

  return (
    <SummarySection title="Add-On Templates">
      <div className="space-y-3">
        <ul className="space-y-2">
          {entries.map((entry) => {
            const templateId = entry!.id;
            const questions = TEMPLATE_QUESTIONS[templateId] ?? [];
            const answersForTpl = addOnsAnswers[templateId] ?? {};
            return (
              <li key={templateId} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 text-primary">✓</span>
                <div className="min-w-0 flex-1">
                  <div>
                    <span className="font-medium">{entry!.name}</span>
                    <span className="text-muted-foreground text-xs ml-2">
                      {entry!.description}
                    </span>
                  </div>
                  {questions.length > 0 && (
                    <ul className="mt-1 ml-4 space-y-0.5">
                      {questions.map((q) => {
                        if (q.type === "auto") {
                          // Auto questions are not rendered in the prompt step
                          // but DO appear here so users see what's been derived
                          // for them. The runtime value is resolved by the use
                          // case at install time.
                          return (
                            <li
                              key={q.id}
                              className="text-xs text-muted-foreground"
                            >
                              <span className="font-mono">{q.id}</span>
                              <span className="italic ml-1">
                                (derived from {q.derivedFrom})
                              </span>
                            </li>
                          );
                        }
                        const raw = answersForTpl[q.id];
                        const display =
                          raw === undefined
                            ? "—"
                            : Array.isArray(raw)
                              ? raw.join(", ") || "—"
                              : String(raw);
                        return (
                          <li
                            key={q.id}
                            className="text-xs text-muted-foreground"
                          >
                            <span className="font-mono">{q.id}</span>:{" "}
                            <span className="text-foreground">{display}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="rounded-md bg-muted/40 border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">
            After downloading and installing dependencies, run:
          </p>
          <code className="text-xs font-mono text-primary block break-all">
            yarn templates:add {selectedIds.join(" ")}
          </code>
        </div>
      </div>
    </SummarySection>
  );
}
