"use client";

import type { CloudChatMessage } from "./hooks/useCloudLlm";
import { ChatMessageList } from "../../components/chat/ChatMessageList";
import { ChatComposer } from "../../components/chat/ChatComposer";

interface CloudChatInterfaceProps {
  messages: CloudChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSendMessage: (content: string) => void;
  onAbort: () => void;
  onClear: () => void;
  onDisconnect: () => void;
  modelName: string;
}

/**
 * Cloud chat panel for the governance assistant. Owns its header (model + clear
 * /disconnect); the transcript (markdown rendering, streaming/error/empty,
 * auto-scroll) and the composer come from the shared `components/chat`
 * primitives, also used by the manifest accept-view context chat.
 */
export function CloudChatInterface({
  messages,
  isStreaming,
  error,
  onSendMessage,
  onAbort,
  onClear,
  onDisconnect,
  modelName,
}: CloudChatInterfaceProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{modelName}</span>
          <span className="text-xs text-muted-foreground">Cloud</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Disconnect
          </button>
        </div>
      </div>

      <ChatMessageList
        messages={messages}
        isStreaming={isStreaming}
        error={error}
        emptyState={
          <p className="text-sm text-muted-foreground text-center py-8">
            Send a message to start chatting with {modelName}.
          </p>
        }
      />

      <ChatComposer
        onSubmit={onSendMessage}
        isStreaming={isStreaming}
        onStop={onAbort}
        placeholder="Type a message..."
      />
    </div>
  );
}
