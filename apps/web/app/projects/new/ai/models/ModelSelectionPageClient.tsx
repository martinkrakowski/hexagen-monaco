"use client";

import { ModelSelectionPage } from "@/manifest-generation/ModelSelectionPage";
import {
  useLocalLLMConfig,
  useLocalLLMStreaming,
} from "@/lib/local-llm-context";

export function ModelSelectionPageClient() {
  const config = useLocalLLMConfig();
  const streaming = useLocalLLMStreaming();
  const llmContext = { ...config, ...streaming };
  return <ModelSelectionPage llmContext={llmContext} />;
}
