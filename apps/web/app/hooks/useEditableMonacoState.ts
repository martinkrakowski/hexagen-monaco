"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Edit mode state machine.
 *
 * Transitions:
 *   readonly       → editing     (user clicks Edit)
 *   editing        → saving      (user clicks Save)
 *   saving         → readonly    (save completes; baseline updated)
 *   editing (no Δ) → readonly    (user clicks Discard with no changes)
 *
 * `hasChanges` is derived inline from content vs baseline — never
 * stored, so it cannot drift from the source of truth.
 */
export type EditorMode =
  | { kind: "readonly" }
  | { kind: "editing"; hasChanges: boolean }
  | { kind: "saving" };

/**
 * Dialog state machine, orthogonal to the editor mode. Opening the
 * discard-confirm dialog doesn't change the editor mode — if the user
 * clicks "Keep Editing", we stay in `editing`; if they confirm, we
 * transition directly to `readonly`.
 */
export type DialogMode = { kind: "none" } | { kind: "discard-confirm" };

export interface UseEditableMonacoStateReturn {
  // Reactive state
  mode: EditorMode;
  dialog: DialogMode;
  content: string;
  baselineContent: string;

  // Edit-flow transitions
  beginEdit: () => void;
  onContentChange: (value: string) => void;
  save: (
    commitBaseline: (content: string) => Promise<void> | void,
  ) => Promise<void>;
  requestDiscard: () => void;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
}

/**
 * Owns the EditableMonaco state machine. Returns discriminated-union
 * state + a flat set of transitions. The caller wires the Monaco
 * onChange into `onContentChange` and provides a `commitBaseline`
 * callback to `save` (which runs side effects like emitCodeChange).
 *
 * When `initialContent` changes (parent switches files), the hook
 * snaps back to readonly via a ref-compare — avoids the stale-render
 * tear you get from the naive useEffect+setState reset pattern.
 */
export function useEditableMonacoState(
  initialContent: string,
): UseEditableMonacoStateReturn {
  const [mode, setMode] = useState<EditorMode>({ kind: "readonly" });
  const [dialog, setDialog] = useState<DialogMode>({ kind: "none" });
  const [content, setContent] = useState(initialContent);
  const [baselineContent, setBaselineContent] = useState(initialContent);

  // Parent swapped the source file: snap back to readonly with fresh
  // baseline. useEffect guard — write only when initialContent
  // actually changed, not on every render.
  const prevInitialRef = useRef(initialContent);
  useEffect(() => {
    if (prevInitialRef.current !== initialContent) {
      prevInitialRef.current = initialContent;
      setContent(initialContent);
      setBaselineContent(initialContent);
      setMode({ kind: "readonly" });
      setDialog({ kind: "none" });
    }
  }, [initialContent]);

  const beginEdit = useCallback(() => {
    setMode({ kind: "editing", hasChanges: false });
  }, []);

  const onContentChange = useCallback(
    (value: string) => {
      setContent(value);
      setMode((prev) =>
        prev.kind === "editing"
          ? { kind: "editing", hasChanges: value !== baselineContent }
          : prev,
      );
    },
    [baselineContent],
  );

  const save = useCallback(
    async (commitBaseline: (content: string) => Promise<void> | void) => {
      setMode({ kind: "saving" });
      try {
        await commitBaseline(content);
        setBaselineContent(content);
        setMode({ kind: "readonly" });
      } catch {
        // Roll back to editing on failure so user doesn't lose edits.
        setMode({ kind: "editing", hasChanges: content !== baselineContent });
      }
    },
    [content, baselineContent],
  );

  const requestDiscard = useCallback(() => {
    setMode((prev) => {
      if (prev.kind !== "editing") return prev;
      if (!prev.hasChanges) {
        // Trivial discard — no dialog needed.
        setContent(baselineContent);
        return { kind: "readonly" };
      }
      // Non-trivial: open confirmation dialog, keep editing mode.
      setDialog({ kind: "discard-confirm" });
      return prev;
    });
  }, [baselineContent]);

  const confirmDiscard = useCallback(() => {
    setContent(baselineContent);
    setMode({ kind: "readonly" });
    setDialog({ kind: "none" });
  }, [baselineContent]);

  const cancelDiscard = useCallback(() => {
    setDialog({ kind: "none" });
  }, []);

  return {
    mode,
    dialog,
    content,
    baselineContent,
    beginEdit,
    onContentChange,
    save,
    requestDiscard,
    confirmDiscard,
    cancelDiscard,
  };
}
