"use client";

import { SuggestionItem } from "../../governance";
import type { SuggestionsSectionProps } from "../types";

export function SuggestionsSection({
  suggestions,
  activeItem,
  onSelectSuggestion,
}: SuggestionsSectionProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mt-4">
      {suggestions.map((s) => (
        <SuggestionItem
          key={s.id}
          suggestion={s}
          isSelected={
            activeItem?.type === "suggestion" && activeItem.item.id === s.id
          }
          onSelect={() => onSelectSuggestion(s)}
        />
      ))}
    </div>
  );
}
