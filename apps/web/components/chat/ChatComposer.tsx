"use client";

import { useState, type FormEvent } from "react";

interface ChatComposerProps {
  /** Called with the trimmed message text on submit. */
  onSubmit: (text: string) => void;
  isStreaming: boolean;
  /** Stop the in-flight stream (shown in place of Send while streaming). */
  onStop: () => void;
  placeholder?: string;
  inputAriaLabel?: string;
}

/**
 * Shared AI-chat composer: a single-line input + Send, swapping to a Stop button
 * while streaming (the input is disabled then). Owns its own draft state and
 * clears on submit; the caller supplies what to do with the text. Shared by both
 * chat panels so the input/affordances stay consistent.
 */
export function ChatComposer({
  onSubmit,
  isStreaming,
  onStop,
  placeholder = "Type a message…",
  inputAriaLabel,
}: ChatComposerProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    onSubmit(trimmed);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 px-4 py-2 border-t border-border shrink-0"
    >
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        disabled={isStreaming}
        aria-label={inputAriaLabel}
        className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
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
  );
}
