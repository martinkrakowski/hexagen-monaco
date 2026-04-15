"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { AgentChatPanel } from "./AgentChatPanel";
import { AIGovernancePanel } from "@/components/ai-governance/AIGovernancePanel";
import { useGovernanceData } from "@/hooks/use-governance-data";
import { useCodeChangeSubscription } from "@/hooks/use-shared-state";
import { Bot, FileText } from "lucide-react";

interface AIArchitectPanelProps {
  onSendMessage?: (message: string) => Promise<void>;
  isLoading?: boolean;
}

export function AIArchitectPanel({
  onSendMessage,
  isLoading = false,
}: AIArchitectPanelProps) {
  const { data, isLoading: isGovernanceLoading, refresh } = useGovernanceData();

  // Re-fetch governance data when the code editor emits a save.
  // Debounce to avoid hammering the API.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useCodeChangeSubscription(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refresh();
    }, 1000);
  });

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <Card className="h-full border-0 rounded-none flex flex-col bg-card">
      <Tabs.Root defaultTab="governance" className="flex-1 overflow-hidden">
        <Tabs.List>
          <Tabs.Trigger value="governance">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Governance</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="chat">
            <Bot className="h-4 w-4" />
            <span className="hidden sm:inline">AI Chat</span>
          </Tabs.Trigger>
        </Tabs.List>

        <CardContent className="flex-1 p-0 overflow-hidden h-full">
          <Tabs.Content value="governance" className="h-full">
            <AIGovernancePanel
              violations={data.violations}
              suggestions={data.suggestions}
              portAdapterStatus={data.portAdapterStatus}
              onRefresh={refresh}
              isLoading={isGovernanceLoading}
            />
          </Tabs.Content>
          <Tabs.Content value="chat" className="h-full">
            <AgentChatPanel
              onSendMessage={onSendMessage}
              isLoading={isLoading}
            />
          </Tabs.Content>
        </CardContent>
      </Tabs.Root>
    </Card>
  );
}
