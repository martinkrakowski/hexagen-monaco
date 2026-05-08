import { useCallback, useState } from "react";
import type { SortField, SortState } from "../domain/project-list";

const DEFAULT_SORT: SortState = { field: "name", direction: "asc" };

export function useProjectSort(initial?: Partial<SortState>) {
  const [sort, setSort] = useState<SortState>({
    ...DEFAULT_SORT,
    ...initial,
  });

  const toggleSort = useCallback((field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return {
          ...prev,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { field, direction: "asc" };
    });
  }, []);

  return { sort, toggleSort };
}
