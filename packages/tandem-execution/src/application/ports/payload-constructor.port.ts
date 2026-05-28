import type { Result } from "@hexagen/shared";

export interface PayloadConstructorOptions {
  userPrompt: string;
  localDraft: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  cloudContextLimit: number;
}

export interface PayloadConstructorResult {
  payload: string;
  truncatedHistory: boolean;
  truncatedDraft: boolean;
}

export interface PayloadConstructorPort {
  constructPayload(
    options: PayloadConstructorOptions,
  ): Result<PayloadConstructorResult, Error>;
}
