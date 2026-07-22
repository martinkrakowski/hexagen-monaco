"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

interface TextareaComposerProps {
  /**
   * Called with the trimmed message text. Resolve `true` to clear the draft;
   * resolve `false` to KEEP it — e.g. seeding the session failed and the user
   * should be able to retry the same text without retyping it.
   */
  onSubmit: (text: string) => Promise<boolean>;
  placeholder?: string;
  inputAriaLabel?: string;
  /** Send-button label. Defaults to "Send". */
  submitLabel?: string;
  /**
   * Optional external gate (e.g. no session exists yet). Unlike the old
   * single-line composer this never disables on streaming — an in-flight
   * request leaves the textarea editable so the user can keep drafting.
   */
  disabled?: boolean;
}

/**
 * Multi-line AI composer for the planning workbench's session modes. Differs
 * from {@link ChatComposer} deliberately: Enter submits / Shift+Enter inserts a
 * newline, there is no Stop affordance, the textarea is not disabled while a
 * request is in flight, and the draft is cleared only when `onSubmit` resolves
 * `true` (a rejected/false result preserves the text for retry). Owns its own
 * draft state; the caller decides what the text does.
 */
export function TextareaComposer({
  onSubmit,
  placeholder = "Describe what you want to plan…",
  inputAriaLabel,
  submitLabel = "Send",
  disabled = false,
}: TextareaComposerProps) {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Ref guard, not the state flag: two synchronous Enter presses share one
  // render, so both would read `isSubmitting === false`. The ref flips
  // immediately and blocks the second call; the state flag only drives the
  // button's disabled styling.
  const inFlightRef = useRef(false);

  const submit = async () => {
    const trimmed = input.trim();
    if (!trimmed || inFlightRef.current || disabled) return;
    inFlightRef.current = true;
    setIsSubmitting(true);
    try {
      const accepted = await onSubmit(trimmed);
      if (accepted) setInput("");
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter (and Enter during IME composition) inserts a
    // newline. `isComposing` guards CJK/IME input where Enter commits a
    // candidate rather than the message.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const canSend = input.trim().length > 0 && !isSubmitting && !disabled;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 px-4 py-2 border-t border-border shrink-0"
    >
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={inputAriaLabel}
        rows={2}
        className="flex-1 min-h-9 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="submit"
        disabled={!canSend}
        className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitLabel}
      </button>
    </form>
  );
}
