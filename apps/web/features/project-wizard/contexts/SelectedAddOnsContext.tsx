"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

interface SelectedAddOnsContextValue {
  selectedIds: string[];
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
  /** Atomically deselect `removeIds` and select `addId` (used to resolve conflicts). */
  replaceConflicting: (addId: string, removeIds: string[]) => void;
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

  const replaceConflicting = useCallback(
    (addId: string, removeIds: string[]) => {
      const remove = new Set(removeIds);
      setSelectedIds((prev) => [
        ...prev.filter((x) => !remove.has(x) && x !== addId),
        addId,
      ]);
    },
    [],
  );

  return (
    <SelectedAddOnsContext.Provider
      value={{ selectedIds, toggle, isSelected, replaceConflicting }}
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
