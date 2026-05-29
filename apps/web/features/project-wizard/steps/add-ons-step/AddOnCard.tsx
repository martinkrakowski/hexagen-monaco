"use client";

import type { CatalogEntry } from "./template-catalog";

interface AddOnCardProps {
  entry: CatalogEntry;
  isSelected: boolean;
  onToggle: () => void;
  blockedBy: string[];
}

export function AddOnCard({
  entry,
  isSelected,
  onToggle,
  blockedBy,
}: AddOnCardProps) {
  const hasBlock = blockedBy.length > 0;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative flex flex-col p-4 cursor-pointer rounded-lg border-2 transition-all text-left w-full ${
        isSelected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/50 hover:bg-muted/30"
      }`}
    >
      {isSelected && (
        <div className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
      )}

      <div className="font-semibold text-sm mb-1 pr-4">{entry.name}</div>
      <p className="text-xs text-muted-foreground flex-1">
        {entry.description}
      </p>

      {entry.requires.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.requires.map((dep) => (
            <span
              key={dep}
              className={`text-xs px-1.5 py-0.5 rounded ${
                hasBlock && blockedBy.includes(dep)
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              requires {dep}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
