"use client";

import { useState, useRef, type FormEvent } from "react";
import type { CloudChatMessage } from "@/hooks/use-cloud-llm";

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
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSendMessage(trimmed);
    setInput("");
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  const visibleMessages = messages.filter((m) => m.role !== "system");

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

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {visibleMessages.length === 0 && !error && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Send a message to start chatting with {modelName}.
          </p>
        )}
        {visibleMessages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm whitespace-pre-wrap ${
              msg.role === "user"
                ? "text-foreground ml-auto mr-0 max-w-[80%]"
                : "text-muted-foreground mr-auto ml-0 max-w-[80%]"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {isStreaming && (
          <div className="text-xs text-muted-foreground animate-pulse">
            Generating...
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-4 py-2 border-t border-border shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming}
          className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
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
    </div>
  );
}
