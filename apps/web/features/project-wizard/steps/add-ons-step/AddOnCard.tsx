"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@hexagen/ui";
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
  const [infoOpen, setInfoOpen] = useState(false);
  const hasBlock = blockedBy.length > 0;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`relative flex flex-col p-4 cursor-pointer rounded-lg border-2 transition-all text-left w-full ${
          isSelected
            ? "border-primary bg-primary/5 shadow-sm"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
      >
        {isSelected && (
          <div className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-primary" />
        )}

        <div className="flex items-center gap-2 mb-1 pr-4">
          <span className="font-semibold text-sm min-w-0 break-words">
            {entry.name}
          </span>
          {entry.note && (
            <span className="inline-flex items-center gap-1 shrink-0 text-xs font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Info size={10} />
              {entry.note.badge}
            </span>
          )}
        </div>
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

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setInfoOpen(true);
          }}
          className="absolute bottom-2.5 right-2.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          aria-label={`About ${entry.name}`}
        >
          <Info size={16} />
        </button>
      </div>

      <Dialog open={infoOpen} onClose={() => setInfoOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <DialogTitle>{entry.name}</DialogTitle>
              <button
                type="button"
                onClick={() => setInfoOpen(false)}
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0 mt-0.5"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <DialogDescription>{entry.details.overview}</DialogDescription>
          </DialogHeader>

          <div>
            <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
              What&apos;s included
            </p>
            <ul className="space-y-1.5">
              {entry.details.includes.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {entry.note && (
            <div className="mt-4 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
              <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                <span>{entry.note.detail}</span>
              </p>
            </div>
          )}

          {entry.conflicts.length > 0 && (
            <div className="mt-4 rounded-md bg-muted/40 border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  Conflicts with:
                </span>{" "}
                {entry.conflicts.join(", ")}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
