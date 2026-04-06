"use client";

import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface AgentMessageProps {
  message: ChatMessage;
}

export function AgentMessage({ message }: AgentMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-2 max-w-[90%]",
        isUser ? "ml-auto flex-row-reverse" : "mr-auto",
      )}
    >
      <div
        className={cn(
          "shrink-0 mt-1",
          isUser ? "text-muted-foreground" : "text-primary",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-muted text-foreground"
            : "bg-primary/10 text-foreground border border-primary/20",
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
