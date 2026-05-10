"use client";

import { AIGenerationPage } from "@/manifest-generation/AIGenerationPage";
import {
  useLocalLLMConfig,
  useLocalLLMStreaming,
} from "@/llm-driver/useLocalLlm";

export function AIGenerationPageClient() {
  const config = useLocalLLMConfig();
  const streaming = useLocalLLMStreaming();
  const llmContext = { ...config, ...streaming };
  return <AIGenerationPage llmContext={llmContext} />;
}
