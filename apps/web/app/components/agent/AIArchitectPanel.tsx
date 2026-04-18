"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { LocalAssistantPanel } from "./LocalAssistantPanel";
import { AIGovernancePanel } from "@/components/ai-governance/AIGovernancePanel";
import { useGovernanceData } from "@/hooks/use-governance-data";
import { useCodeChangeSubscription } from "@/hooks/use-shared-state";
import { governanceState } from "@/lib/governance-state";
import { useLocalLLM } from "@/hooks/use-local-llm";
import { Bot, FileText, Loader2 } from "lucide-react";

const HAS_ENABLED_KEY = "hexagen:local-llm:has-enabled";
const AUTO_LOAD_KEY = "hexagen:local-llm:auto-load";

export function AIArchitectPanel() {
  const [isCheckingCache, setIsCheckingCache] = useState(true);
  const [activeTab, setActiveTab] = useState<"chat" | "governance">(
    "governance",
  );

  const {
    data,
    isLoading: isGovernanceLoading,
    refresh,
    refreshWithData,
  } = useGovernanceData();

  const { engineState, hasAnyCachedModel, enterRequiresModel } = useLocalLLM();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useCodeChangeSubscription(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const { currentManifestYaml, currentOpenFileContent } = governanceState;
      if (currentManifestYaml) {
        refreshWithData(
          currentManifestYaml,
          currentOpenFileContent || undefined,
        );
      } else {
        refresh();
      }
    }, 1000);
  });

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // 1. Initial Mount: Async State Evaluation
  useEffect(() => {
    let isMounted = true;

    const evaluateInitialState = async () => {
      // Boot Guard: Abort if WebLLM adapter hasn't mounted yet
      if (engineState.status === "unavailable") {
        return;
      }

      // Check both keys: HAS_ENABLED_KEY (new) and AUTO_LOAD_KEY (legacy).
      // Users from before HAS_ENABLED_KEY was introduced only have AUTO_LOAD_KEY.
      const isOptedIn =
        localStorage.getItem(HAS_ENABLED_KEY) !== null ||
        localStorage.getItem(AUTO_LOAD_KEY) === "true";

      // Opted-In Hold: If user is opted in but the engine is still in its
      // transit state (opt_in before auto-load starts) or actively loading,
      // hold the spinner until the engine transitions to an active state.
      if (
        isOptedIn &&
        (engineState.status === "opt_in" || engineState.autoLoading)
      ) {
        return;
      }

      try {
        if (!isMounted) return;

        if (!isOptedIn) {
          // State A: User has never enabled Local AI
          setIsCheckingCache(false);
        } else if (
          engineState.loadedModelId ||
          engineState.status === "downloading" ||
          engineState.status === "loading_vram"
        ) {
          // State B: Model is selected or loading in background
          setIsCheckingCache(false);
        } else {
          // State C: Previously enabled but no model selected
          enterRequiresModel();
          setActiveTab("chat");
          setIsCheckingCache(false);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to check cached models:", error);
        if (isMounted) setIsCheckingCache(false);
      }
    };

    evaluateInitialState();

    return () => {
      isMounted = false;
    };
  }, [
    hasAnyCachedModel,
    engineState.loadedModelId,
    engineState.status,
    engineState.autoLoading,
    enterRequiresModel,
  ]);

  // 2. Reactive Session Listener: Catch mid-session status changes
  useEffect(() => {
    if (engineState.status === "requires_model") {
      setActiveTab("chat");
    }
  }, [engineState.status]);

  // Anti-Flicker Gate
  if (isCheckingCache) {
    return (
      <Card className="h-full border-0 rounded-none flex flex-col bg-card">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full border-0 rounded-none flex flex-col bg-card">
      <Tabs.Root
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as "chat" | "governance")}
        className="flex-1 overflow-hidden"
      >
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
            <LocalAssistantPanel />
          </Tabs.Content>
        </CardContent>
      </Tabs.Root>
    </Card>
  );
}
