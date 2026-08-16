"use client";

import { AIGenerationPage } from "@/manifest-generation/AIGenerationPage";
import {
  useLocalLLMConfig,
  useLocalLLMStreaming,
} from "@/lib/local-llm-context";

export function AIGenerationPageClient() {
  const config = useLocalLLMConfig();
  const streaming = useLocalLLMStreaming();
  const llmContext = { ...config, ...streaming };
  return <AIGenerationPage llmContext={llmContext} />;
}
