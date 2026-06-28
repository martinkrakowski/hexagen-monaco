"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useContextChatPanel } from "./store/useContextChatPanel";
import type { ContextView } from "./store/useContextChatPanel";
import { useGovernanceChat } from "./useGovernanceChat";
import { buildContextQuestion } from "./build-context-question";

const MODEL_NAME = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

/**
 * The governance chat transcript + composer, shared by both presentations of
 * the context chat: the in-frame desktop panel (ContextGovernanceChatPanel) and
 * the mobile slide-in overlay (ContextGovernanceChatDrawer). Owns the streaming
 * hook and the seed-once logic so the two containers are pure chrome — and so
 * the chat (and its `useGovernanceChat` state) exists exactly once, since only
 * one container is mounted at a time (gated by viewport).
 *
 * Seeding: whenever a *new* context is selected (`open(ctx)` sets a fresh
 * `selectedContext` reference), one grounded governance question is auto-sent.
 * Re-opening the same context (same reference) does not re-seed, so a collapse
 * /expand preserves the conversation.
 */
export function ContextChatConversation() {
  const selectedContext = useContextChatPanel((s) => s.selectedContext);
  const { messages, status, errorMessage, sendMessage, abort } =
    useGovernanceChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isStreaming = status === "streaming";

  // The context the chat was last seeded for + its grounding prompt: seed once
  // per distinct context, and keep follow-ups grounded in the same context.
  const seededForRef = useRef<ContextView | null>(null);
  const systemPromptRef = useRef("");

  useEffect(() => {
    if (!selectedContext) return;
    if (seededForRef.current === selectedContext) return;
    seededForRef.current = selectedContext;

    const { systemPrompt, seedQuestion } =
      buildContextQuestion(selectedContext);
    systemPromptRef.current = systemPrompt;
    void sendMessage(seedQuestion, {
      model: MODEL_NAME,
      systemPrompt,
      reset: true,
    });
  }, [selectedContext, sendMessage]);

  // Keep the transcript pinned to the latest message as it streams. Assigning
  // scrollTop (not scrollTo, which jsdom doesn't implement) keeps tests safe.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    void sendMessage(trimmed, {
      model: MODEL_NAME,
      systemPrompt: systemPromptRef.current,
    });
  };

  const visibleMessages = messages.filter((m) => m.role !== "system");

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 custom-scrollbar"
      >
        {visibleMessages.length === 0 && !errorMessage && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Click a context to ask the AI about it.
          </p>
        )}
        {visibleMessages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm whitespace-pre-wrap ${
              msg.role === "user"
                ? "text-foreground ml-auto mr-0 max-w-[85%]"
                : "text-muted-foreground mr-auto ml-0 max-w-[85%]"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {isStreaming && (
          <div className="text-xs text-muted-foreground animate-pulse">
            Generating…
          </div>
        )}
        {errorMessage && (
          <p className="text-xs text-destructive">{errorMessage}</p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-4 py-2 border-t border-border shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a follow-up…"
          disabled={isStreaming}
          aria-label="Ask a follow-up question"
          className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={abort}
            className="h-9 px-3 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
