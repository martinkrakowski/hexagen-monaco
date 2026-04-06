"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { AgentChatPanel } from "./AgentChatPanel";
import { AIGovernancePanel } from "@/components/ai-governance/AIGovernancePanel";
import { Bot, FileText } from "lucide-react";

type TabType = "chat" | "governance";

interface AIArchitectPanelProps {
  onSendMessage?: (message: string) => Promise<void>;
  isLoading?: boolean;
}

export function AIArchitectPanel({
  onSendMessage,
  isLoading = false,
}: AIArchitectPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("governance");

  return (
    <Card className="h-full border-0 rounded-none flex flex-col bg-card">
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("governance")}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium transition-colors ${
            activeTab === "governance"
              ? "text-primary border-b-2 border-primary bg-muted/50"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="h-4 w-4" />
          <span className="hidden sm:inline">Governance</span>
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium transition-colors ${
            activeTab === "chat"
              ? "text-primary border-b-2 border-primary bg-muted/50"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline">AI Chat</span>
        </button>
      </div>

      <CardContent className="flex-1 p-0 overflow-hidden">
        {activeTab === "governance" && (
          <AIGovernancePanel
            onRefresh={() => {
              console.log("Refresh AI Governance data");
            }}
          />
        )}
        {activeTab === "chat" && (
          <AgentChatPanel onSendMessage={onSendMessage} isLoading={isLoading} />
        )}
      </CardContent>
    </Card>
  );
}
