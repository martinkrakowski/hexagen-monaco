export interface ActiveWorkspace {
  projectId: string;
  isDirty: boolean;
  lastModifiedAt: number;
}

export function createActiveWorkspace(
  projectId: string,
  isDirty: boolean = false,
): ActiveWorkspace {
  return {
    projectId,
    isDirty,
    lastModifiedAt: Date.now(),
  };
}

export function markWorkspaceClean(
  workspace: ActiveWorkspace,
): ActiveWorkspace {
  return {
    ...workspace,
    isDirty: false,
    lastModifiedAt: Date.now(),
  };
}

export function markWorkspaceDirty(
  workspace: ActiveWorkspace,
): ActiveWorkspace {
  return {
    ...workspace,
    isDirty: true,
    lastModifiedAt: Date.now(),
  };
}
