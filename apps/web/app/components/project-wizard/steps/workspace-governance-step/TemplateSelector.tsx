"use client";

import {
  workspaceTemplates,
  getWorkspaceTemplate,
  type WorkspaceTemplate,
} from "@hexagen/shared";

import { TemplateCard } from "./TemplateCard";

interface TemplateSelectorProps {
  selectedTemplateId: string;
  onSelectTemplate: (id: string) => void;
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

/**
 * Architectural-template picker. Renders a 3-column grid of
 * TemplateCards and a details preview of the currently-selected
 * template below. Uses the workspaceTemplates catalogue from
 * @hexagen/shared as its source of options.
 */
export function TemplateSelector({
  selectedTemplateId,
  onSelectTemplate,
}: TemplateSelectorProps) {
  const selectedTemplate = getWorkspaceTemplate(selectedTemplateId);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Architectural Template
        </label>
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
            onSelect={() => onSelectTemplate(template.id)}
          />
        ))}
      </div>
      {selectedTemplate && <TemplateDetails template={selectedTemplate} />}
    </div>
  );
}
