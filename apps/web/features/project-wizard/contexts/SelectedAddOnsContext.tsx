"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

interface SelectedAddOnsContextValue {
  selectedIds: string[];
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
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

  return (
    <SelectedAddOnsContext.Provider value={{ selectedIds, toggle, isSelected }}>
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
