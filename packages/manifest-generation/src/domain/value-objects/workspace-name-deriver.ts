export interface WorkspaceNameDeriverInput {
  description: string;
  maxLength?: number;
}

export interface WorkspaceNameDeriverOutput {
  name: string;
  description: string;
}

export function deriveWorkspaceName(
  description: string,
  maxLength: number = 200,
): WorkspaceNameDeriverOutput {
  const workspaceName = description
    .slice(0, 60)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return {
    name: workspaceName || "generated-project",
    description: description.slice(0, maxLength),
  };
}
