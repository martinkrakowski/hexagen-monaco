"use client";

import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

interface SelectedAddOnsContextValue {
  selectedIds: string[];
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
  /**
   * Atomically deselect `removeIds` and select `addIds` (union). Used to add a
   * template together with its required dependencies — optionally swapping out
   * conflicting selections in the same update — so a cancelled prompt never
   * leaves a partial selection. Already-selected ids keep their position;
   * only genuinely new ids are appended (deduped, order-stable).
   */
  resolveSelection: (addIds: string[], removeIds: string[]) => void;
}

const SelectedAddOnsContext = createContext<SelectedAddOnsContextValue | null>(
  null,
);

/**
 * Add-on selection backed by the wizard form's `addOnsAnswers` — the single
 * source of truth. A selected add-on is exactly a key in `addOnsAnswers`, so
 * selection is:
 *   - **visible to the canvas** (the overlay reads `wizardData.addOnsAnswers`), and
 *   - **persisted across reloads** (`addOnsAnswers` is saved/loaded with the project).
 *
 * Selecting an add-on adds an (initially empty) answers entry; the
 * template-questions step fills it in. Deselecting removes the entry (and its
 * answers). Must be rendered inside the wizard FormProvider.
 */
export function SelectedAddOnsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { control, getValues, setValue } = useFormContext<ProjectConfig>();

  // Reactive: re-derive selection whenever addOnsAnswers changes (incl. on load,
  // so a persisted selection survives a refresh).
  const answers = useWatch({ control, name: "addOnsAnswers" });
  const selectedIds = useMemo(() => Object.keys(answers ?? {}), [answers]);

  const commit = useCallback(
    (next: Record<string, unknown>) =>
      setValue("addOnsAnswers", next as ProjectConfig["addOnsAnswers"], {
        shouldDirty: true,
        shouldTouch: true,
      }),
    [setValue],
  );

  const toggle = useCallback(
    (id: string) => {
      const current: Record<string, unknown> = {
        ...(getValues("addOnsAnswers") ?? {}),
      };
      if (id in current) {
        delete current[id];
      } else {
        current[id] = current[id] ?? {};
      }
      commit(current);
    },
    [getValues, commit],
  );

  const isSelected = useCallback(
    (id: string) => id in (answers ?? {}),
    [answers],
  );

  const resolveSelection = useCallback(
    (addIds: string[], removeIds: string[]) => {
      const remove = new Set(removeIds);
      const current: Record<string, unknown> = {
        ...(getValues("addOnsAnswers") ?? {}),
      };
      for (const id of removeIds) delete current[id];
      for (const id of addIds) {
        if (!remove.has(id) && !(id in current)) current[id] = {};
      }
      commit(current);
    },
    [getValues, commit],
  );

  return (
    <SelectedAddOnsContext.Provider
      value={{ selectedIds, toggle, isSelected, resolveSelection }}
    >
      {children}
    </SelectedAddOnsContext.Provider>
  );
}

export function useSelectedAddOns(): SelectedAddOnsContextValue {
  const ctx = useContext(SelectedAddOnsContext);
  if (!ctx) {
    throw new Error(
      "useSelectedAddOns must be used within a SelectedAddOnsProvider",
    );
  }
  return ctx;
}
