"use client";

import { useFormContext, type FieldPath } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { ArrowLeft } from "lucide-react";

import { ContextFormInfrastructure } from "./ContextFormInfrastructure";
import { ContextFormDomain } from "./ContextFormDomain";

interface ContextFormProps {
  fieldPrefix: string;
  onBack: () => void;
  readOnly?: boolean;
}

export function ContextForm({
  fieldPrefix,
  onBack,
  readOnly,
}: ContextFormProps) {
  const { register } = useFormContext<ProjectConfig>();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="shrink-0 p-2 border-b border-border">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to context list
        </button>
      </div>

      <fieldset disabled={readOnly} className="p-2 space-y-3">
        <label className="block w-full">
          <span className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
            Context Name
          </span>
          <input
            type="text"
            {...register(`${fieldPrefix}.name` as FieldPath<ProjectConfig>)}
            className="w-full px-3 py-2 border border-input rounded-md text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none bg-background"
            placeholder="e.g. SalesContext"
          />
        </label>

        <ContextFormInfrastructure fieldPrefix={fieldPrefix} />

        <ContextFormDomain fieldPrefix={fieldPrefix} />
      </fieldset>
    </div>
  );
}
