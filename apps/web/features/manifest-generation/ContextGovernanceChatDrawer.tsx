"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Sparkles } from "lucide-react";
import { useContextChatPanel } from "./store/useContextChatPanel";
import type { ContextView } from "./store/useContextChatPanel";
import { useGovernanceChat } from "./useGovernanceChat";
import { buildContextQuestion } from "./build-context-question";

const MODEL_NAME = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

/**
 * Right slide-in AI governance chat panel for the accept view. Opens when a
 * bounded-context card is clicked (via `useContextChatPanel`), auto-sends one
 * grounded governance question about that context, and streams the answer. The
 * panel stays mounted (translated off-screen when closed) so re-opening the same
 * context keeps its conversation; opening a different context re-seeds.
 *
 * The chat UI is inlined (rather than reusing governance-assistant's
 * CloudChatInterface) to respect the feature-isolation lint rule — and it's a
 * tighter fit here (the drawer already owns the header/close).
 */
export function ContextGovernanceChatDrawer() {
  const { selectedContext, isOpen, close } = useContextChatPanel();
  const { messages, status, errorMessage, sendMessage, abort } =
    useGovernanceChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const isStreaming = status === "streaming";

  // The context the chat was last seeded for + its grounding prompt. Used to
  // (a) seed exactly once per distinct context and (b) keep follow-ups grounded.
  const seededForRef = useRef<ContextView | null>(null);
  const systemPromptRef = useRef("");

  // Seed once whenever a *new* context is selected. `open(ctx)` sets a fresh
  // `selectedContext` reference, so re-opening the same context (same ref) does
  // not re-seed, while clicking a different card does.
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

  // Escape closes the drawer.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  // Move focus into the drawer when it opens, and restore it to the triggering
  // element (the context card) on close. Combined with `inert` while closed,
  // this keeps the keyboard flow sane — the off-screen drawer is never tabbable.
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = (document.activeElement as HTMLElement) ?? null;
      closeButtonRef.current?.focus();
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen]);

  // Keep the transcript scrolled to the latest message as it streams. Assigning
  // scrollTop (rather than scrollTo, which jsdom doesn't implement) keeps this
  // safe under the test environment.
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
    <aside
      role="dialog"
      aria-label={
        selectedContext
          ? `AI governance chat about the ${selectedContext.name} context`
          : "AI governance chat"
      }
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={`fixed top-0 right-0 z-40 h-full w-full sm:w-[400px] max-w-[90vw] bg-background border-l border-border shadow-xl flex flex-col transition-transform duration-300 ease-in-out ${
        isOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-info shrink-0" />
          <span className="text-sm font-semibold truncate">
            AI · {selectedContext?.name ?? "Governance"}
          </span>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={close}
          aria-label="Close AI chat"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-card"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
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
    </aside>
  );
}
