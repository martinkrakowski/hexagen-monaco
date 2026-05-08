"use client";

import { AIGenerationPage } from "@/manifest-generation/AIGenerationPage";
import { useLocalLLM } from "@/llm-driver/useLocalLlm";

export function AIGenerationPageClient() {
  const llmContext = useLocalLLM();
  return <AIGenerationPage llmContext={llmContext} />;
}
