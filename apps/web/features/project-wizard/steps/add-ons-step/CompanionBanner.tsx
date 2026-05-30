"use client";

import { useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { Button } from "@hexagen/ui";

export interface CompanionSuggestion {
  /** Id of the companion template the banner is offering to add. */
  id: string;
  /** Human-readable name (rendered bold). */
  name: string;
  /** One-line explanation of what the companion adds. */
  description: string;
}

interface CompanionBannerProps {
  /**
   * Companions to surface. Each is independently dismissable. The container
   * hides itself when every suggestion has been dismissed (or none remain).
   */
  suggestions: CompanionSuggestion[];
  /** Called when the user clicks "+ Add <name>" on a row. */
  onAdd: (id: string) => void;
}

// Show all rows up to this threshold; beyond it, collapse extras under
// "[+N more]" until the user clicks to expand. Picked at 3 so the common
// case (one or two companions per selected template) renders in full while
// pathological catalogs don't push the banner off-screen.
const COLLAPSE_THRESHOLD = 3;

/**
 * A discoverability nudge rendered in the add-ons step when one or more
 * selected templates have unselected companion templates. Each suggestion is a
 * separate row with its own add/dismiss controls; presentation state (which
 * rows have been dismissed, whether the [+N more] section is expanded) is
 * local component state — it is intentionally not persisted, so the user can
 * deselect and re-select the parent to bring suggestions back.
 *
 * Tokens-only styling: bg-muted/30 surface, border-border outline, foreground
 * + muted-foreground text, primary accent for the icon. Spacing is on the
 * 4px baseline (gap-2 = 8px, gap-3 = 12px, p-3 = 12px). Focus / disabled
 * states are inherited from @hexagen/ui Button.
 */
export function CompanionBanner({
  suggestions,
  onAdd,
}: CompanionBannerProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);

  const visible = suggestions.filter((s) => !dismissed.has(s.id));
  if (visible.length === 0) return null;

  const initialBatch = expanded
    ? visible
    : visible.slice(0, COLLAPSE_THRESHOLD);
  const overflowCount = visible.length - initialBatch.length;

  return (
    <div
      role="region"
      aria-label="Companion templates"
      className="mt-6 rounded-lg border border-border bg-muted/30 p-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb size={16} className="text-primary flex-shrink-0" />
        <h3 className="text-xs font-semibold text-foreground">
          Companion templates
        </h3>
      </div>
      <ul className="flex flex-col gap-2">
        {initialBatch.map((s) => (
          <li
            key={s.id}
            className="flex items-start justify-between gap-3 rounded-md p-2 hover:bg-muted/40 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs text-foreground">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {s.description}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={() => onAdd(s.id)}>
                + Add {s.name}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setDismissed((prev) => {
                    const next = new Set(prev);
                    next.add(s.id);
                    return next;
                  });
                }}
                aria-label={`Dismiss ${s.name} suggestion`}
                className="text-muted-foreground/60 hover:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <X size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {overflowCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          +{overflowCount} more
        </button>
      )}
    </div>
  );
}
