// apps/web/app/lib/wire.shared.ts
// Environment-agnostic dependency composition
// Safe to import in any context (server or client)
/* eslint-disable no-console */
// Console is intentional here: this file implements LoggerPort and emits
// logger diagnostics. All other application code must use LoggerPort instead.

import type { LoggerPort } from "@hexagen/shared";
import type { EventBusPort, IntentBusPort } from "@hexagen/messaging";
import type { LLMProviderPort } from "@hexagen/agentic-interaction";
import {
  InMemoryEventBusAdapter,
  InMemoryIntentBusAdapter,
} from "@hexagen/messaging";
import { ServerLLMAdapter } from "@hexagen/agentic-interaction";

// Create console-based logger for web app
export const createWebLogger = (): LoggerPort => ({
  info: (msg) => console.log(`[web] ${msg}`),
  warn: (msg) => console.warn(`[web] ${msg}`),
  error: (msg) => console.error(`[web] ${msg}`),
  debug: (msg) => {
    if (process.env.DEBUG) console.log(`[debug] ${msg}`);
  },
  errorWithException: (err, msg) => {
    const errorMessage =
      msg ?? (err instanceof Error ? err.message : String(err));
    console.error(`[web] ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  },
});

export const createEventBus = (): EventBusPort => new InMemoryEventBusAdapter();

export const createIntentBus = (): IntentBusPort =>
  new InMemoryIntentBusAdapter();

export const createLLMProvider = (): LLMProviderPort => {
  const apiKey = process.env.LLM_API_KEY || "";
  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    /**
     * Warn only in development environments to avoid exposing configuration
     * concerns in production logs. Production logging should capture actual
     * failures (requests failing due to missing auth), not configuration issues.
     */
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[LLMProviderPort] No API key configured - LLM features will be disabled",
      );
    }
  }

  return new ServerLLMAdapter(apiKey, baseUrl, model);
};
