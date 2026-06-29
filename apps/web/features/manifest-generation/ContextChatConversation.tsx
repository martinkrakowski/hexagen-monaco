"use client";

import { useEffect, useRef } from "react";
import { useContextChatPanel } from "./store/useContextChatPanel";
import type { ContextView } from "./store/useContextChatPanel";
import { useGovernanceChat } from "./useGovernanceChat";
import { buildContextQuestion } from "./build-context-question";
import { useContextFixes } from "./useContextFixes";
import { ContextFixSuggestions } from "./ContextFixSuggestions";
import { usePendingManifest } from "./store/usePendingManifest";
import { ChatMessageList } from "../../components/chat/ChatMessageList";
import { ChatComposer } from "../../components/chat/ChatComposer";

const MODEL_NAME = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

/**
 * The governance chat transcript + composer, shared by both presentations of
 * the context chat: the in-frame desktop panel (ContextGovernanceChatPanel) and
 * the mobile slide-in overlay (ContextGovernanceChatDrawer). Owns the streaming
 * hook and the seed-once logic; the transcript/composer themselves come from the
 * shared `components/chat` primitives (also used by the governance-assistant
 * cloud chat). Because only one container is mounted at a time, the chat — and
 * its `useGovernanceChat` state — exists exactly once.
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

  // Only extract fixes when there's a manifest to edit (selector returns a bool
  // so it re-renders only when presence flips, not on every yaml change).
  const hasManifest = usePendingManifest((s) => s.yaml != null);
  // The review has settled once streaming has stopped and there's a non-empty
  // assistant turn (an errored review leaves status "error" → no fix extraction).
  // Scope it to the *current* context: right after a switch, the previous
  // context's transcript is still in `messages` (status idle) for one render
  // before the seed effect resets it — `seededForRef.current === selectedContext`
  // is false in that window (the seed effect hasn't run yet), so we don't extract
  // fixes against a stale, completed review.
  const reviewComplete =
    status === "idle" &&
    seededForRef.current === selectedContext &&
    messages.some((m) => m.role === "assistant" && m.content.trim().length > 0);
  const {
    fixes,
    status: fixStatus,
    appliedIds,
    markApplied,
  } = useContextFixes(selectedContext, reviewComplete && hasManifest);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <ChatMessageList
        messages={messages}
        isStreaming={isStreaming}
        error={errorMessage}
        emptyState={
          <p className="text-sm text-muted-foreground text-center py-8">
            Click a context to ask the AI about it.
          </p>
        }
      />
      <ContextFixSuggestions
        fixes={fixes}
        status={fixStatus}
        appliedIds={appliedIds}
        onApplied={markApplied}
      />
      <ChatComposer
        onSubmit={(text) =>
          void sendMessage(text, {
            model: MODEL_NAME,
            systemPrompt: systemPromptRef.current,
          })
        }
        isStreaming={isStreaming}
        onStop={abort}
        placeholder="Ask a follow-up…"
        inputAriaLabel="Ask a follow-up question"
      />
    </div>
  );
}
