"use client";

import { useState, useRef, useEffect, createContext, useContext } from "react";
import { CardContent } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { LocalAgentMessage } from "./LocalAgentMessage";
import type { ChatMessage } from "@/hooks/useLocalLlm";
import { Loader2, Send, Bot } from "lucide-react";

interface LocalChatInterfaceProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (content: string) => Promise<void>;
}

interface ChatContextValue {
  isLoading: boolean;
}

const ChatContext = createContext<ChatContextValue>({ isLoading: false });

function useChatContext() {
  return useContext(ChatContext);
}

function LoadingIndicator() {
  const { isLoading } = useChatContext();
  if (!isLoading) return null;
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Generating...</span>
    </div>
  );
}

interface SendButtonProps {
  onClick: () => void;
  hasInput: boolean;
}

function SendButton({ onClick, hasInput }: SendButtonProps) {
  const { isLoading } = useChatContext();
  return (
    <PrimaryButton
      onClick={onClick}
      disabled={!hasInput || isLoading}
      size="icon"
      className="shrink-0 h-9 w-9"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Send className="h-4 w-4" />
      )}
    </PrimaryButton>
  );
}

export function LocalChatInterface({
  messages,
  isStreaming,
  onSendMessage,
}: LocalChatInterfaceProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const trimmed = input.trim();
    setInput("");
    await onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <ChatContext.Provider value={{ isLoading: isStreaming }}>
      <div className="flex flex-col h-full bg-card">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Local AI</span>
          <span className="text-xs text-muted-foreground ml-auto">
            Phi-3-mini
          </span>
        </div>

        <CardContent className="flex-1 overflow-auto p-3 space-y-3 custom-scrollbar">
          {messages.map((message) => (
            <LocalAgentMessage key={message.id} message={message} />
          ))}
          <LoadingIndicator />
          <div ref={messagesEndRef} />
        </CardContent>

        <div className="p-3 border-t border-border bg-card/50">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your architecture..."
              className="min-h-[60px] resize-none text-sm"
              disabled={isStreaming}
            />
            <SendButton onClick={handleSend} hasInput={!!input.trim()} />
          </div>
        </div>
      </div>
    </ChatContext.Provider>
  );
}
