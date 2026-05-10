"use client";

import React from "react";
import { useController, type Control } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import {
  workspaceTemplates,
  getWorkspaceTemplate,
  type WorkspaceTemplate,
} from "@hexagen/project-configuration";

import { TemplateCard } from "./TemplateCard";

interface TemplateSelectorProps {
  control: Control<ProjectConfig>;
}

interface TemplateDetailsProps {
  template: WorkspaceTemplate;
}

const CROSS_CONTEXT_DETAILS: Record<string, string> = {
  "in-process": "Direct TypeScript imports between contexts",
  "event-bus": "All cross-context calls via event bus",
  network: "All cross-context calls via network RPC",
};

function TemplateDetails({ template }: TemplateDetailsProps) {
  const crossContextDetail =
    CROSS_CONTEXT_DETAILS[template.rules.crossContextCalls];

  return (
    <div className="p-3 bg-muted/40 border border-border rounded-lg space-y-2">
      <div className="text-xs font-semibold text-foreground">
        {template.title}
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <div>
          {template.rules.allowSharedUi
            ? "Shared UI app allowed"
            : "UI isolated per context"}
        </div>
        {crossContextDetail && <div>{crossContextDetail}</div>}
      </div>
    </div>
  );
}

export const TemplateSelector = React.memo(function TemplateSelector({
  control,
}: TemplateSelectorProps) {
  const { field } = useController({
    name: "governance.workspaceTemplate",
    control,
  });

  const selectedTemplateId = (field.value as string) || "modular-monolith";
  const selectedTemplate = getWorkspaceTemplate(selectedTemplateId);

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Architectural Template
        </span>
        <p className="text-xs text-muted-foreground mt-1">
          This determines cross-context communication rules and isolation
          boundaries for the generated project.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {workspaceTemplates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            isSelected={selectedTemplateId === template.id}
            onSelect={() =>
              field.onChange(
                template.id as ProjectConfig["governance"]["workspaceTemplate"],
              )
            }
          />
        ))}
      </div>
      {selectedTemplate && <TemplateDetails template={selectedTemplate} />}
    </div>
  );
});
