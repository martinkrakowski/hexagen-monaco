"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChatMarkdown } from "./ChatMarkdown";

export interface ChatMessageLike {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatMessageListProps {
  messages: ChatMessageLike[];
  isStreaming: boolean;
  /** Optional error to surface beneath the transcript. */
  error?: string | null;
  /** Rendered (already styled) when there are no visible messages and no error. */
  emptyState: ReactNode;
  className?: string;
}

/**
 * Shared AI-chat transcript: system messages hidden, user turns as plain text
 * (they typed it), assistant turns rendered as markdown (the model emits GFM),
 * plus the streaming indicator, error line, empty state, and auto-scroll. Used by
 * both the governance-assistant cloud chat and the manifest accept-view context
 * chat (each owns its hook + chrome; this is the shared presentation).
 */
export function ChatMessageList({
  messages,
  isStreaming,
  error,
  emptyState,
  className,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = messages.filter((m) => m.role !== "system");

  // Keep pinned to the latest as it streams. Assigning scrollTop (not scrollTo,
  // which jsdom doesn't implement) keeps this safe under the test environment.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-3 custom-scrollbar ${className ?? ""}`}
    >
      {visible.length === 0 && !error && emptyState}
      {visible.map((msg) =>
        msg.role === "user" ? (
          <div
            key={msg.id}
            className="text-sm whitespace-pre-wrap text-foreground ml-auto mr-0 max-w-[85%]"
          >
            {msg.content}
          </div>
        ) : (
          <div key={msg.id} className="text-sm mr-auto ml-0 max-w-[85%]">
            <ChatMarkdown content={msg.content} />
          </div>
        ),
      )}
      {isStreaming && (
        <div className="text-xs text-muted-foreground animate-pulse">
          Generating…
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
