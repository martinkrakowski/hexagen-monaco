"use client";

import { useEffect, useRef } from "react";
import { X, Sparkles } from "lucide-react";
import { useContextChatPanel } from "./store/useContextChatPanel";
import { ContextChatConversation } from "./ContextChatConversation";

/**
 * Mobile slide-in AI governance chat overlay for the accept view. On desktop the
 * chat lives in-frame as a resizable column (ContextGovernanceChatPanel); below
 * the md breakpoint there's no room for a third column, so it falls back to this
 * fixed overlay. ManifestPreview mounts exactly one of the two (by viewport), so
 * the shared ContextChatConversation — and its chat state — exists only once.
 *
 * Opens when a bounded-context card is clicked (via `useContextChatPanel`). The
 * overlay stays mounted (translated off-screen + inert when closed) so the
 * off-screen chat is never tabbable and re-opening preserves the conversation.
 */
export function ContextGovernanceChatDrawer() {
  const { selectedContext, isOpen, close } = useContextChatPanel();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

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

      <ContextChatConversation />
    </aside>
  );
}
