"use client";

import { useState, useRef, useEffect, createContext, useContext } from "react";
import { CardContent } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { AgentMessage } from "./AgentMessage";
import { Loader2, Send, Bot } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface ChatContextValue {
  isLoading: boolean;
}

const ChatContext = createContext<ChatContextValue>({ isLoading: false });

function useChatContext() {
  return useContext(ChatContext);
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function LoadingIndicator() {
  const { isLoading } = useChatContext();
  if (!isLoading) return null;
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Thinking...</span>
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

// ─── Main Component ───────────────────────────────────────────────────────────

interface AgentChatPanelProps {
  onSendMessage?: (message: string) => Promise<void>;
  isLoading?: boolean;
}

export function AgentChatPanel({
  onSendMessage,
  isLoading = false,
}: AgentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "I'm your AI Architecture Assistant. I can help you design bounded contexts, suggest ports/adapters, and review your architecture. What would you like to work on?",
      timestamp: Date.now() - 60000,
    },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    if (onSendMessage) {
      try {
        await onSendMessage(userMessage.content);
      } catch {
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Sorry, I encountered an error processing your request.",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <ChatContext.Provider value={{ isLoading }}>
      <div className="flex flex-col h-full bg-card">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI Assistant</span>
        </div>

        <CardContent className="flex-1 overflow-auto p-3 space-y-3 custom-scrollbar">
          {messages.map((message) => (
            <AgentMessage key={message.id} message={message} />
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
              disabled={isLoading}
            />
            <SendButton onClick={handleSend} hasInput={!!input.trim()} />
          </div>
        </div>
      </div>
    </ChatContext.Provider>
  );
}
