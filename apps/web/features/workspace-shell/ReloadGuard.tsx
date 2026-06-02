"use client";

import { useEffect } from "react";

import { useEditorGuard } from "@/contexts/EditorGuardContext";

/**
 * Registers a `beforeunload` handler while the editor has unsaved changes, so a
 * page reload/close/external-navigation triggers the browser's native
 * "Leave site? Changes you made may not be saved." prompt.
 *
 * Browsers do not allow a custom dialog at this point — the in-app
 * Save/Discard/Cancel dialog (UnsavedEditorChangesDialog) covers app-controlled
 * navigation instead.
 */
export function ReloadGuard() {
  const { hasUnsavedChanges } = useEditorGuard();

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy requirement for the native prompt in some browsers.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  return null;
}
