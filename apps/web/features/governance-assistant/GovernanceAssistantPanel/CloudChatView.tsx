"use client";

import { CloudChatInterface } from "../CloudChatInterface";
import { PanelFooter } from "../governance";

interface CloudChatViewProps {
  onModeChange: (mode: "local" | "cloud") => void;
  cloudMessages: Array<{ role: "user" | "assistant"; content: string }>;
  cloudLLMStatus: string;
  cloudLLMError: string | null;
  onSendMessage: (content: string) => void;
  onAbort: () => void;
  onClear: () => void;
  onDisconnect: () => void;
  modelName: string;
}

export function CloudChatView({
  onModeChange,
  cloudMessages,
  cloudLLMStatus,
  cloudLLMError,
  onSendMessage,
  onAbort,
  onClear,
  onDisconnect,
  modelName,
}: CloudChatViewProps) {
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
          className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
        >
          Cloud
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <CloudChatInterface
          messages={cloudMessages as any}
          isStreaming={cloudLLMStatus === "streaming"}
          error={cloudLLMError}
          onSendMessage={onSendMessage}
          onAbort={onAbort}
          onClear={onClear}
          onDisconnect={onDisconnect}
          modelName={modelName}
        />
      </div>
      <PanelFooter showHint={false} />
    </div>
  );
}
