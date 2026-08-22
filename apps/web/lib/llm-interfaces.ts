"use client";

import type { DomainModelId, LocalLLMContext } from "@hexagen/local-llm";

/**
 * Interface for Local LLM engine state
 */
export interface LocalLLMState {
  status: string;
  progress?: number;
  loadedModelId?: DomainModelId;
  errorMessage?: string;
}

/**
 * Local LLM context provider props
 */
export interface LocalLLMProviderProps {
  children: React.ReactNode;
}

/**
 * A module that exposes LLM driver interfaces without direct imports
 * This allows feature boundaries to be maintained
 */
export type { DomainModelId, LocalLLMContext };
