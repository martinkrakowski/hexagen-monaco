"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

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

export function SelectedAddOnsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds],
  );

  const resolveSelection = useCallback(
    (addIds: string[], removeIds: string[]) => {
      const remove = new Set(removeIds);
      setSelectedIds((prev) => {
        const next = prev.filter((x) => !remove.has(x));
        const present = new Set(next);
        for (const id of addIds) {
          if (!remove.has(id) && !present.has(id)) {
            next.push(id);
            present.add(id);
          }
        }
        return next;
      });
    },
    [],
  );

  return (
    <SelectedAddOnsContext.Provider
      value={{
        selectedIds,
        toggle,
        isSelected,
        resolveSelection,
      }}
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
