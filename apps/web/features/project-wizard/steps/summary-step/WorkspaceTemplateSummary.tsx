"use client";

import { getWorkspaceTemplate } from "@hexagen/project-configuration";

import { SummarySection } from "./SummarySection";

interface WorkspaceTemplateSummaryProps {
  workspaceTemplate: string | undefined;
}

/**
 * Displays the human-readable title of the selected workspace
 * template, resolved via getWorkspaceTemplate from @hexagen/shared.
 */
export function WorkspaceTemplateSummary({
  workspaceTemplate,
}: WorkspaceTemplateSummaryProps) {
  const title = workspaceTemplate
    ? (getWorkspaceTemplate(workspaceTemplate)?.title ?? "Not selected")
    : "Not selected";

  return (
    <SummarySection title="Workspace Template">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{title}</span>
        </div>
      </div>
    </SummarySection>
  );
}
