"use client";

import { TandemChatInterface } from "./TandemChatInterface";
import { PanelFooter } from "../governance";
import type { UseTandemLlmReturn } from "../hooks/useTandemLlm";

interface TandemChatViewProps extends UseTandemLlmReturn {
  displayMode?: "overwrite" | "append";
  onModeChange: (mode: "local" | "cloud" | "tandem") => void;
  onOpenSettings: () => void;
  localModelName?: string;
  cloudModelName?: string;
}

export function TandemChatView({
  messages,
  status,
  currentStage,
  sendMessage,
  abort,
  stageAwareAbort,
  clear,
  displayMode = "overwrite",
  canRetry,
  retryCloudRefinement,
  lastBypassReason,
  lastResponseWasPartial,
  lastErrorType,
  hasOomEvent,
  clearBypassReason,
  onModeChange,
  onOpenSettings,
  localModelName,
  cloudModelName,
}: TandemChatViewProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => onModeChange("local")}
          className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Local
        </button>
        <button
          type="button"
          onClick={() => onModeChange("cloud")}
          className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cloud
        </button>
        <button
          type="button"
          className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
        >
          Tandem
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <TandemChatInterface
          messages={messages}
          status={status}
          currentStage={currentStage}
          displayMode={displayMode}
          onSendMessage={(content) => {
            void sendMessage({
              content,
              conversationId: "governance-tandem",
              localModelState: "ACTIVE",
              cloudHealthState: "VALID",
            });
          }}
          onAbort={abort}
          onStageAwareAbort={stageAwareAbort}
          onClear={clear}
          onOpenSettings={onOpenSettings}
          canRetry={canRetry}
          onRetry={retryCloudRefinement}
          lastBypassReason={lastBypassReason}
          lastResponseWasPartial={lastResponseWasPartial}
          lastErrorType={lastErrorType}
          hasOomEvent={hasOomEvent}
          clearBypassReason={clearBypassReason}
          localModelName={localModelName}
          cloudModelName={cloudModelName}
        />
      </div>
      <PanelFooter showHint={false} />
    </div>
  );
}
