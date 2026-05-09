"use client";

import { ModelSelectionPage } from "@/manifest-generation/ModelSelectionPage";
import { useLocalLLM } from "@/llm-driver/useLocalLlm";

export function ModelSelectionPageClient() {
  const llmContext = useLocalLLM();
  return <ModelSelectionPage llmContext={llmContext} />;
}
