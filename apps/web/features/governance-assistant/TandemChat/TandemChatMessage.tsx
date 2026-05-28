"use client";

import { useState } from "react";
import { TandemStageBadge } from "./TandemStageBadge";
import { TandemTokenPanel } from "./TandemTokenPanel";
import type { TandemChatMessage as TandemChatMessageType } from "../hooks/useTandemLlm";

interface TandemChatMessageProps {
  message: TandemChatMessageType;
  displayMode: "overwrite" | "append";
  onOpenSettings: () => void;
  isByok?: boolean;
}

export function TandemChatMessage({
  message,
  displayMode,
  onOpenSettings,
  isByok = false,
}: TandemChatMessageProps) {
  const [stage1Collapsed, setStage1Collapsed] = useState(false);
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false);

  if (message.role === "user") {
    return (
      <div className="text-sm whitespace-pre-wrap text-foreground ml-auto mr-0 max-w-[80%]">
        {message.visibleContent}
      </div>
    );
  }

  if (message.stage === "error") {
    return (
      <div className="mr-auto ml-0 max-w-[80%] space-y-1">
        <TandemStageBadge stage="error" />
        <p className="text-sm text-destructive">
          {message.errorLabel ?? "An error occurred during tandem execution."}
        </p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-xs text-primary underline hover:text-primary/80"
        >
          Open Settings
        </button>
      </div>
    );
  }

  // Only complete tandem assistant messages show the ⓘ token details button.
  const showTokenButton = message.stage === "complete" && message.isTandem;

  // Shared ⓘ button rendered at the top-right corner of the message bubble.
  const tokenInfoButton = showTokenButton ? (
    <button
      type="button"
      aria-label="Show token details"
      aria-expanded={tokenPanelOpen}
      onClick={() => setTokenPanelOpen((prev) => !prev)}
      className="text-xs text-muted-foreground hover:text-foreground leading-none"
    >
      ⓘ
    </button>
  ) : null;

  // Append mode: stage1Draft is present and displayMode is "append".
  // NOTE: stage1Draft is only rendered here — in the append branch — so that on
  // session reload (where displayMode defaults back to "overwrite"), a rehydrated
  // message with stage === "complete" and a stage1Draft field will NEVER expose
  // stage1Draft in the visible DOM. The overwrite branch (below) only renders
  // visibleContent, ensuring the guard holds without any additional logic.
  if (displayMode === "append" && message.stage1Draft) {
    return (
      <div className="mr-auto ml-0 max-w-[80%] space-y-2">
        <div className="flex items-center justify-between">
          <TandemStageBadge stage={message.stage} />
          {tokenInfoButton}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Local Draft
            </span>
            <button
              type="button"
              onClick={() => setStage1Collapsed((prev) => !prev)}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              {stage1Collapsed ? "Show" : "Hide"}
            </button>
          </div>
          {!stage1Collapsed && (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {message.stage1Draft}
            </p>
          )}
        </div>

        {message.visibleContent && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Cloud Refinement
              </span>
              <div className="flex-1 border-t border-border" />
            </div>
            <p className="text-sm whitespace-pre-wrap text-foreground">
              {message.visibleContent}
            </p>
          </>
        )}

        {tokenPanelOpen && (
          <TandemTokenPanel
            tokenMetadata={message.tokenMetadata}
            isByok={isByok}
          />
        )}
      </div>
    );
  }

  // Overwrite / in-progress mode.
  // RELOAD GUARD: stage1Draft is intentionally NOT rendered here. If a message
  // is rehydrated from persisted state with stage === "complete" and a
  // stage1Draft value, only visibleContent is shown. The append branch above
  // is gated on `displayMode === "append"`, which resets to "overwrite" on
  // reload, so stage1Draft is never leaked into the visible DOM on reload.
  const isTransitioningWithNoStage3 =
    message.stage === "transitioning" && !message.visibleContent;

  return (
    <div className="mr-auto ml-0 max-w-[80%] space-y-1">
      <div className="flex items-center justify-between">
        <TandemStageBadge stage={message.stage} />
        {tokenInfoButton}
      </div>
      <p
        className={`text-sm whitespace-pre-wrap text-foreground transition-opacity duration-[400ms] ${
          isTransitioningWithNoStage3 ? "opacity-50" : "opacity-100"
        }`}
      >
        {message.visibleContent}
      </p>
      {tokenPanelOpen && (
        <TandemTokenPanel
          tokenMetadata={message.tokenMetadata}
          isByok={isByok}
        />
      )}
    </div>
  );
}
