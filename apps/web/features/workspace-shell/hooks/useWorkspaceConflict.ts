"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingWorkspaceConflict } from "@hexagen/shared";
import { getEditorWorkspaceConflicts } from "@/lib/wire";

export interface UseWorkspaceConflictResult {
  conflict: PendingWorkspaceConflict | null;
  keepThisDevice(): Promise<boolean>;
  useOtherDevice(): Promise<boolean>;
}

export function useWorkspaceConflict(
  projectId: string | null,
): UseWorkspaceConflictResult {
  const [conflict, setConflict] = useState<PendingWorkspaceConflict | null>(
    null,
  );

  useEffect(() => {
    if (projectId === null) {
      setConflict(null);
      return;
    }
    const port = getEditorWorkspaceConflicts();
    const read = () => {
      const next = port.getPendingConflict(projectId);
      setConflict((previous) => {
        if (previous === null && next === null) return previous;
        if (
          previous !== null &&
          next !== null &&
          previous.where === next.where &&
          previous.at === next.at
        ) {
          return previous;
        }
        return next;
      });
    };
    read();
    return port.subscribe(read);
  }, [projectId]);

  const keepThisDevice = useCallback(async (): Promise<boolean> => {
    if (projectId === null) return false;
    try {
      const result = await getEditorWorkspaceConflicts().keepThisDeviceCopy(
        projectId,
      );
      return result.success;
    } catch {
      return false;
    }
  }, [projectId]);

  const useOtherDevice = useCallback(async (): Promise<boolean> => {
    if (projectId === null) return false;
    try {
      const result = await getEditorWorkspaceConflicts().useOtherDeviceCopy(
        projectId,
      );
      return result.success;
    } catch {
      return false;
    }
  }, [projectId]);

  return { conflict, keepThisDevice, useOtherDevice };
}
