"use client";

import { LabeledInput } from "./LabeledInput";

interface IdentityFieldsProps {
  workspaceName: string;
  workspaceDescription: string;
  namespacePrefix: string;
  onChangeName: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangeNamespacePrefix: (value: string) => void;
}

/**
 * Three identity fields for the workspace: name (required),
 * description (optional), and namespace prefix (required). Presented
 * in-order as a vertically-stacked group.
 */
export function IdentityFields({
  workspaceName,
  workspaceDescription,
  namespacePrefix,
  onChangeName,
  onChangeDescription,
  onChangeNamespacePrefix,
}: IdentityFieldsProps) {
  return (
    <>
      <LabeledInput
        label="Workspace Name"
        value={workspaceName}
        onChange={onChangeName}
        placeholder="@mycompany"
      />

      <LabeledInput
        label={
          <>
            Description{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </>
        }
        value={workspaceDescription}
        onChange={onChangeDescription}
        placeholder="Core enterprise platform monorepo"
      />

      <LabeledInput
        label="Namespace Prefix"
        value={namespacePrefix}
        onChange={onChangeNamespacePrefix}
        placeholder="@hexagen"
      />
    </>
  );
}
