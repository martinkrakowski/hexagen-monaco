"use client";

import { Save, X, Edit3, Loader2 } from "lucide-react";
import type { EditorMode } from "@/hooks/useEditableMonacoState";

interface EditorToolbarProps {
  language: string;
  mode: EditorMode;
  onEdit: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background h-8 px-3";

/**
 * Top toolbar for the editable Monaco editor. Shows language label and
 * edit/save/discard controls. Stateless — all state and handlers flow
 * in from the owning component.
 */
export function EditorToolbar({
  language,
  mode,
  onEdit,
  onSave,
  onDiscard,
}: EditorToolbarProps) {
  const isEditing = mode.kind === "editing";
  const isSaving = mode.kind === "saving";
  const hasChanges = mode.kind === "editing" && mode.hasChanges;

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-mono uppercase">
          {language}
        </span>
        {isEditing && (
          <span
            className={`text-xs ${hasChanges ? "text-amber-500" : "text-emerald-500"}`}
          >
            {hasChanges ? "Unsaved changes" : "Editing"}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!isEditing && !isSaving ? (
          <button
            type="button"
            onClick={onEdit}
            className={`${BUTTON_BASE} border border-input hover:bg-accent hover:text-accent-foreground`}
          >
            <Edit3 className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onDiscard}
              disabled={isSaving}
              className={`${BUTTON_BASE} hover:bg-destructive/10 text-destructive disabled:opacity-50 disabled:pointer-events-none`}
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              Discard
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving || !hasChanges}
              className={`${BUTTON_BASE} bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none`}
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}
