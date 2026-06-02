"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Tracks whether the code editor has unsaved (in-buffer) changes and exposes
 * the active editor's save/discard actions, so navigation guards (a
 * `beforeunload` reload guard and an in-app "unsaved changes" dialog) can warn
 * and act without reaching into the editor directly.
 *
 * The active `EditableMonaco` registers its dirty flag + handlers; only one
 * editor is active at a time, so a single registration slot is sufficient.
 */
interface GuardHandlers {
  save: () => Promise<void>;
  discard: () => void;
}

interface EditorGuardContextValue {
  hasUnsavedChanges: boolean;
  /** Called by the active editor when its dirty state or handlers change. */
  register: (dirty: boolean, handlers: GuardHandlers | null) => void;
  /** Save via the active editor (no-op if none registered). */
  save: () => Promise<void>;
  /** Discard via the active editor (no-op if none registered). */
  discard: () => void;
}

const EditorGuardContext = createContext<EditorGuardContextValue | null>(null);

export function EditorGuardProvider({ children }: { children: ReactNode }) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const handlersRef = useRef<GuardHandlers | null>(null);

  const register = useCallback(
    (dirty: boolean, handlers: GuardHandlers | null) => {
      handlersRef.current = handlers;
      setHasUnsavedChanges(dirty);
    },
    [],
  );

  const save = useCallback(async () => {
    await handlersRef.current?.save();
  }, []);

  const discard = useCallback(() => {
    handlersRef.current?.discard();
  }, []);

  const value = useMemo(
    () => ({ hasUnsavedChanges, register, save, discard }),
    [hasUnsavedChanges, register, save, discard],
  );

  return (
    <EditorGuardContext.Provider value={value}>
      {children}
    </EditorGuardContext.Provider>
  );
}

/** Throws if used outside the provider — for guard components/dialogs. */
export function useEditorGuard(): EditorGuardContextValue {
  const ctx = useContext(EditorGuardContext);
  if (!ctx) {
    throw new Error(
      "useEditorGuard must be used within an EditorGuardProvider",
    );
  }
  return ctx;
}

/** Non-throwing — for the editor, which may render outside the provider. */
export function useEditorGuardOptional(): EditorGuardContextValue | null {
  return useContext(EditorGuardContext);
}
