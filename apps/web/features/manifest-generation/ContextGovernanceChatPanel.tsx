"use client";

import { Sparkles, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useContextChatPanel } from "./store/useContextChatPanel";
import { ContextChatConversation } from "./ContextChatConversation";

interface ContextGovernanceChatPanelProps {
  /** Collapse the column (wired to the surrounding resizable Panel). */
  onRequestCollapse: () => void;
}

/**
 * In-frame AI governance chat column for the accept view's desktop layout. It
 * sits as the third resizable column (right of the context map) and mirrors the
 * left YAML sidebar's chrome — a bordered `bg-sidebar` aside with a compact
 * header — so the three columns read as one panelled frame. The header's chevron
 * collapses the column to a thin strip (ContextChatCollapsedStrip).
 */
export function ContextGovernanceChatPanel({
  onRequestCollapse,
}: ContextGovernanceChatPanelProps) {
  const selectedContext = useContextChatPanel((s) => s.selectedContext);

  return (
    <aside className="flex flex-col h-full border-l border-border bg-sidebar overflow-hidden">
      {/* width owned by the surrounding react-resizable-panels Panel */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <Sparkles className="w-4 h-4 text-accent shrink-0" />
        <span className="text-xs font-semibold text-muted-foreground font-mono truncate">
          AI · {selectedContext?.name ?? "Governance"}
        </span>
        <button
          type="button"
          onClick={onRequestCollapse}
          aria-label="Collapse AI chat"
          title="Collapse"
          className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-card"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>
      <ContextChatConversation />
    </aside>
  );
}

interface ContextChatCollapsedStripProps {
  /** Expand the column back open. */
  onExpand: () => void;
}

/**
 * The collapsed presentation of the AI chat column: a thin vertical strip (same
 * `bg-sidebar` skin) with the AI affordance, shown beside the panel group while
 * the chat column is collapsed. Mirrors the workspace shell's CollapsedStrip
 * pattern, kept local to respect the feature-isolation rule.
 */
export function ContextChatCollapsedStrip({
  onExpand,
}: ContextChatCollapsedStripProps) {
  return (
    <div className="flex flex-col items-center gap-2 w-9 shrink-0 border-l border-border bg-sidebar py-2">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Open AI chat"
        title="Ask the AI about a context"
        className="p-1.5 rounded-md text-accent hover:bg-card"
      >
        <PanelRightOpen className="w-4 h-4" />
      </button>
      <Sparkles className="w-4 h-4 text-accent animate-soft-pulse" />
      <span className="mt-1 text-xs font-mono uppercase tracking-widest text-muted-foreground [writing-mode:vertical-rl]">
        AI Chat
      </span>
    </div>
  );
}
