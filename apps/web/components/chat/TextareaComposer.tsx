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
    // Snapshot the exact draft we're submitting: the textarea stays editable
    // in flight, so the user may keep typing while we await onSubmit.
    const draftAtSubmit = input;
    const trimmed = draftAtSubmit.trim();
    if (!trimmed || inFlightRef.current || disabled) return;
    inFlightRef.current = true;
    setIsSubmitting(true);
    try {
      const accepted = await onSubmit(trimmed);
      // Clear ONLY the draft we submitted. If the user typed a new draft while
      // the request was in flight, `current !== draftAtSubmit` and we keep it —
      // clearing unconditionally here would silently discard their new text.
      if (accepted)
        setInput((current) => (current === draftAtSubmit ? "" : current));
    } catch {
      // onSubmit is documented to resolve `false` on failure; a throw is an
      // unexpected contract break we treat the same way — keep the draft so the
      // user can retry. Swallowing here also stops the `void submit()` call
      // sites from producing an unhandled promise rejection. Surfacing the
      // error to the user is the caller's responsibility (it owns onSubmit).
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
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    // Nothing to send / already sending / gated off: let Enter behave like a
    // normal textarea key (insert a newline) instead of swallowing it with a
    // preventDefault that blocks the newline yet triggers no submit.
    if (!input.trim() || inFlightRef.current || disabled) return;
    e.preventDefault();
    void submit();
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
