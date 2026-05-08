"use client";

import React from "react";
import { ChevronsUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { SortField, SortState } from "../domain/project-list";

interface SortableColumnHeaderProps {
  label: string;
  field: SortField;
  currentSort: SortState;
  onToggleSort: (field: SortField) => void;
}

export function SortableColumnHeader({
  label,
  field,
  currentSort,
  onToggleSort,
}: SortableColumnHeaderProps) {
  const isActive = currentSort.field === field;
  const icon = isActive
    ? currentSort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ChevronsUpDown;

  return (
    <th
      aria-sort={
        isActive
          ? currentSort.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
      className={`text-sm font-medium px-3 py-2 ${isActive ? "text-foreground" : "text-muted-foreground"}`}
    >
      <button
        type="button"
        onClick={() => onToggleSort(field)}
        className="inline-flex items-center gap-1 cursor-pointer transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {label}
        {React.createElement(icon, { className: "h-3 w-3" })}
      </button>
    </th>
  );
}
