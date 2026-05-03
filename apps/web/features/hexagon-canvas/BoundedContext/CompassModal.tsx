"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CompassModalProps } from "./types";

export function CompassModal({ label, items, onClose }: CompassModalProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--overlay)/0.4)] backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        role="document"
        aria-label={label}
        className="relative w-80 rounded-xl border border-border bg-background shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={16} />
        </button>
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
          {label}
        </h3>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No items defined.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item, idx) => (
              <li
                key={`${label}-${item}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-muted/50 text-foreground border border-border/50"
              >
                <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
                  {idx + 1}
                </span>
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
