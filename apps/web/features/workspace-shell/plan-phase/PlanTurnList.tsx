"use client";

import type { ProjectLayerTurn } from "@hexagen/shared";
import { ChatMarkdown } from "@/chat/ChatMarkdown";

interface PlanTurnListProps {
  turns: readonly ProjectLayerTurn[];
}

/**
 * Renders a planning layer's turns as authored markdown. Built directly over
 * `ChatMarkdown` rather than adapting `ChatMessageList`: that primitive
 * hard-codes a binary user/assistant role model (plain-text right-aligned user
 * turns, no author-label surface), which can't express a multi-party session
 * (Grok / Claude / You / Imported).
 *
 * "Alternating styling" is per AUTHOR, not per index: each distinct author gets
 * a stable accent from a small cycle (first-seen order), so a two-agent session
 * visually alternates and a turn keeps its accent when other turns are removed.
 */
const AUTHOR_ACCENTS = [
  "border-l-primary/60",
  "border-l-info/60",
  "border-l-warning/60",
] as const;

export function PlanTurnList({ turns }: PlanTurnListProps) {
  const accentByAuthor = new Map<string, string>();
  for (const turn of turns) {
    if (!accentByAuthor.has(turn.author)) {
      accentByAuthor.set(
        turn.author,
        AUTHOR_ACCENTS[accentByAuthor.size % AUTHOR_ACCENTS.length],
      );
    }
  }

  return (
    <ol className="space-y-3 list-none p-0 m-0">
      {turns.map((turn) => (
        <li
          key={turn.id}
          className={`border-l-2 ${accentByAuthor.get(turn.author)} bg-card rounded-r-md px-4 py-3`}
        >
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs font-semibold text-foreground">
              {turn.author}
            </span>
            {turn.at !== undefined && (
              // `toLocaleString()` is locale/timezone-dependent, so server and
              // browser output can differ and trip a hydration mismatch on this
              // text node. suppressHydrationWarning scopes the tolerance to just
              // the timestamp (the repo's pattern for locale-dependent text, cf.
              // layout.tsx / useTheme.tsx) — CodeRabbit #405.
              <span
                className="text-xs text-muted-foreground"
                suppressHydrationWarning
              >
                {new Date(turn.at).toLocaleString()}
              </span>
            )}
          </div>
          <ChatMarkdown content={turn.content} />
        </li>
      ))}
    </ol>
  );
}
