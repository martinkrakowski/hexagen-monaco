import { useCallback, useState } from "react";

export function useProjectSelection() {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (allIds: readonly string[], checked: boolean) => {
      setSelectedIds(checked ? new Set(allIds) : new Set());
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const allSelected = useCallback(
    (allIds: readonly string[]) =>
      allIds.length > 0 && allIds.every((id) => selectedIds.has(id)),
    [selectedIds],
  );

  const count = selectedIds.size;

  return {
    selectedIds,
    count,
    toggle,
    toggleAll,
    clearSelection,
    isSelected,
    allSelected,
  };
}
