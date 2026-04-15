"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { AgentChatPanel } from "./AgentChatPanel";
import { AIGovernancePanel } from "@/components/ai-governance/AIGovernancePanel";
import { useGovernanceData } from "@/hooks/use-governance-data";
import {
  useCodeChangeSubscription,
  useSharedState,
} from "@/hooks/use-shared-state";
import { Bot, FileText, RefreshCw, Code2 } from "lucide-react";
import { MonacoEditorWrapper } from "@/components/monaco/MonacoEditorWrapper";

interface AIArchitectPanelProps {
  onSendMessage?: (message: string) => Promise<void>;
  isLoading?: boolean;
}

export function AIArchitectPanel({
  onSendMessage,
  isLoading = false,
}: AIArchitectPanelProps) {
  const { data, isLoading: isGovernanceLoading, refresh } = useGovernanceData();
  const [lastCodeUpdate, setLastCodeUpdate] = useState<string | null>(null);
  const { lastCodeChange } = useSharedState();

  useCodeChangeSubscription((event) => {
    setLastCodeUpdate(new Date().toLocaleTimeString());
  }, []);

  return (
    <Card className="h-full border-0 rounded-none flex flex-col bg-card">
      <Tabs.Root defaultTab="editor" className="flex-1 overflow-hidden">
        <Tabs.List>
          <Tabs.Trigger value="editor">
            <Code2 className="h-4 w-4" />
            <span className="hidden sm:inline">Editor</span>
          </Tabs.Trigger>
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
          <Tabs.Content value="editor" className="h-full">
            <MonacoEditorWrapper
              initialBuffer={lastCodeChange?.content || ""}
              sessionId="ai-panel-editor"
              language="yaml"
            />
          </Tabs.Content>
          <Tabs.Content value="governance" className="h-full">
            <div className="relative h-full">
              {lastCodeUpdate && (
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground bg-muted/80 rounded-md backdrop-blur-sm">
                  <RefreshCw className="h-3 w-3" />
                  Updated: {lastCodeUpdate}
                </div>
              )}
              <AIGovernancePanel
                violations={data.violations}
                suggestions={data.suggestions}
                portAdapterStatus={data.portAdapterStatus}
                onRefresh={refresh}
                isLoading={isGovernanceLoading}
              />
            </div>
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
