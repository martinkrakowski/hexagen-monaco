"use client";

import { useState, useRef, type FormEvent } from "react";
import { TandemChatMessage } from "./TandemChatMessage";
import { TandemStageBadge } from "./TandemStageBadge";
import { TandemStopControl } from "./TandemStopControl";
import { TandemRetryButton } from "./TandemRetryButton";
import { TandemToast } from "./TandemToast";
import { TandemInlineBanner } from "./TandemInlineBanner";
import type {
  TandemChatMessage as TandemChatMessageType,
  TandemStatus,
} from "../hooks/useTandemLlm";

interface TandemChatInterfaceProps {
  messages: TandemChatMessageType[];
  status: TandemStatus;
  currentStage: "idle" | "stage1" | "transitioning" | "stage3";
  displayMode: "overwrite" | "append";
  onSendMessage: (content: string) => void;
  onAbort: () => void;
  onStageAwareAbort: (stage: "stage1" | "stage3" | "full") => void;
  onClear: () => void;
  onOpenSettings: () => void;
  canRetry: boolean;
  onRetry: () => Promise<void>;
  lastBypassReason: string | null;
  lastResponseWasPartial: boolean;
  lastErrorType: string | null;
  hasOomEvent: boolean;
  clearBypassReason: () => void;
  localModelName?: string;
  cloudModelName?: string;
}

export function TandemChatInterface({
  messages,
  status,
  currentStage,
  displayMode,
  onSendMessage,
  onStageAwareAbort,
  onClear,
  onOpenSettings,
  canRetry,
  onRetry,
  lastBypassReason,
  lastResponseWasPartial,
  lastErrorType,
  hasOomEvent,
  clearBypassReason,
  localModelName,
  cloudModelName,
}: TandemChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isDisabled = status !== "idle";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isDisabled) return;
    onSendMessage(trimmed);
    setInput("");
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  const pipelineStage =
    status === "stage1"
      ? "stage1"
      : status === "transitioning"
        ? "transitioning"
        : status === "stage3"
          ? "stage3"
          : null;

  // Derive stage-aware abort handler based on currentStage
  const handleStopClick = () => {
    if (currentStage === "stage1") {
      onStageAwareAbort("stage1");
    } else if (currentStage === "stage3") {
      onStageAwareAbort("stage3");
    } else {
      onStageAwareAbort("full");
    }
  };

  // Derived notification flags
  const showMemoryBypassToast = lastBypassReason === "memory_insufficient";
  const showQualityGateInlineBanner =
    lastBypassReason !== null &&
    lastBypassReason !== "memory_insufficient" &&
    lastBypassReason !== "none";
  const showRateLimitBanner = canRetry && lastErrorType === "rate_limited";

  return (
    <>
      {/* Transient floating toast for memory headroom bypass */}
      {showMemoryBypassToast && (
        <TandemToast
          message="Local model bypassed — insufficient memory headroom."
          onDismiss={clearBypassReason}
          autoDismissMs={5000}
        />
      )}

      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Tandem</span>
            <span className="text-xs text-muted-foreground">
              {localModelName && cloudModelName
                ? `${localModelName} → ${cloudModelName}`
                : "Local + Cloud"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        </div>

        {/* Inline quality-gate skip toast (auto-dismiss 4s) */}
        {showQualityGateInlineBanner && (
          <TandemInlineBanner
            variant="warning"
            message="Local draft skipped — output was not usable."
            onDismiss={clearBypassReason}
            autoDismissMs={4000}
          />
        )}

        {/* Persistent OOM banner — no dismiss */}
        {hasOomEvent && (
          <TandemInlineBanner
            variant="warning"
            message="Local model was terminated due to memory limits. Cloud fallback used."
          />
        )}

        {/* Rate limit error banner with Retry */}
        {showRateLimitBanner && (
          <TandemInlineBanner
            variant="error"
            message="Cloud rate limit reached — showing local draft."
            onRetry={onRetry}
            retryLabel="Retry"
          />
        )}

        {/* Partial stream warning */}
        {lastResponseWasPartial && (
          <TandemInlineBanner
            variant="warning"
            message="[Response ended unexpectedly]"
          />
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Send a message to start a tandem session.
            </p>
          )}
          {messages.map((msg, idx) => {
            const isLast = idx === messages.length - 1;
            return (
              <div key={msg.id}>
                <TandemChatMessage
                  message={msg}
                  displayMode={displayMode}
                  onOpenSettings={onOpenSettings}
                />
                {isLast && msg.role === "assistant" && (
                  <TandemRetryButton
                    canRetry={canRetry}
                    onRetry={handleRetry}
                    isLoading={isRetrying}
                  />
                )}
              </div>
            );
          })}
          {status === "error" && messages.length === 0 && (
            <p className="text-xs text-destructive text-center">
              An error occurred. Check settings and try again.
            </p>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-4 py-2 border-t border-border shrink-0"
        >
          <div className="flex-1 flex flex-col gap-1">
            {pipelineStage && (
              <div className="flex items-center gap-1.5">
                <TandemStageBadge
                  stage={pipelineStage}
                  localModelName={localModelName}
                  cloudModelName={cloudModelName}
                />
              </div>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              disabled={isDisabled}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
            />
          </div>
          {isDisabled ? (
            <div className="flex flex-col items-end gap-1 self-end">
              <TandemStopControl
                currentStage={currentStage}
                status={status}
                onAbortStage1={() => onStageAwareAbort("stage1")}
                onAbortStage3={() => onStageAwareAbort("stage3")}
                onAbortFull={() => onStageAwareAbort("full")}
              />
              {/* Fallback generic stop button when TandemStopControl renders null
                (e.g. status=error but isDisabled — shouldn't normally occur) */}
              {status !== "stage1" &&
                status !== "transitioning" &&
                status !== "stage3" && (
                  <button
                    type="button"
                    onClick={handleStopClick}
                    className="h-9 px-3 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 self-end"
                    aria-label="Stop"
                  >
                    Stop
                  </button>
                )}
            </div>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed self-end"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </>
  );
}
