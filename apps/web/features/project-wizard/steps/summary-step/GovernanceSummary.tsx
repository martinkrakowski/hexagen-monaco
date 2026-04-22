"use client";

import type { ProjectConfig } from "@hexagen/project-configuration";

import { SummarySection } from "./SummarySection";

interface GovernanceSummaryProps {
  governance: ProjectConfig["governance"] | undefined;
}

interface FieldRowProps {
  label: string;
  value: string;
}

function FieldRow({ label, value }: FieldRowProps) {
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * Read-only summary of the governance fields the user configured in
 * the WorkspaceGovernance step. Four fields in a 2×2 grid with
 * fallback defaults for unset values.
 */
export function GovernanceSummary({ governance }: GovernanceSummaryProps) {
  return (
    <SummarySection title="Workspace Governance">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <FieldRow label="Name" value={governance?.workspaceName || "Not set"} />
        <FieldRow
          label="Package Manager"
          value={governance?.packageManager || "yarn"}
        />
        <FieldRow
          label="Topology"
          value={governance?.topologyStrictness || "flexible"}
        />
        <FieldRow
          label="Namespace"
          value={governance?.namespacePrefix || "@hexagen"}
        />
      </div>
    </SummarySection>
  );
}
