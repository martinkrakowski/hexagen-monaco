// Shared fixtures for the telemetry span tests in this directory: the
// in-memory tracer provider, the env-backed vault, the provider chain
// configs, the fetch/SSE response stubs, and the span assertions every
// file repeats. Case-specific data (bodies, frames, forbidden strings)
// stays in the test files; only the repeated scaffolding lives here.

import { expect } from "vitest";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type {
  CloudProviderEndpoint,
  ProviderFallbackChain,
} from "../../../src/domain/provider-config";

/**
 * Registers an in-memory tracer provider and returns its exporter; pair
 * with `teardownTelemetry()` in `afterEach`.
 */
export function setupTelemetry(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  return exporter;
}

/** Drops the global tracer provider so the next test starts uninstrumented. */
export function teardownTelemetry(): void {
  trace.disable();
}

/** Sets each env key for the current test; `deleteEnvKeys` removes them. */
export function setEnvKeys(keys: Record<string, string>): void {
  for (const [key, value] of Object.entries(keys)) {
    process.env[key] = value;
  }
}

/** Removes the env keys a test set — call from `afterEach`. */
export function deleteEnvKeys(keys: readonly string[]): void {
  for (const key of keys) {
    delete process.env[key];
  }
}

/** A secrets vault reading from `process.env`, as the adapters ship. */
export function envVault(): { getSecret: (name: string) => string | null } {
  return { getSecret: (name: string) => process.env[name] ?? null };
}

/** The openai-primary, no-fallback chain the telemetry tests configure. */
export function openaiChain(apiKeyEnvVar: string): ProviderFallbackChain {
  return {
    primary: openaiProvider(apiKeyEnvVar),
    fallbacks: [],
  };
}

/** The openai-primary + mistral-fallback chain the fallback tests use. */
export function chainWithMistralFallback(
  primaryKeyEnvVar: string,
  fallbackKeyEnvVar: string,
): ProviderFallbackChain {
  return {
    primary: openaiProvider(primaryKeyEnvVar),
    fallbacks: [mistralProvider(fallbackKeyEnvVar)],
  };
}

function openaiProvider(apiKeyEnvVar: string): CloudProviderEndpoint {
  return {
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnvVar,
    temperature: 0.4,
    maxTokens: 4096,
    timeoutMs: 60000,
  };
}

function mistralProvider(apiKeyEnvVar: string): CloudProviderEndpoint {
  return {
    providerId: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
    apiKeyEnvVar,
    temperature: 0.4,
    maxTokens: 4096,
    timeoutMs: 60000,
  };
}

/** One SSE frame carrying a content delta. */
export function sseChunk(content: string): string {
  return `data: {"choices":[{"delta":{"content":${JSON.stringify(
    content,
  )}}}]}\n`;
}

/** An ok Response carrying a JSON body (`json` and `text` views). */
export function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** A non-ok Response carrying a status and body text. */
export function failureResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  } as Response;
}

/**
 * An ok Response whose body streams the given frames, then closes — or,
 * when `error` is given, errors instead, but only after the queued frames
 * are deliverable (`error()` discards unread queued chunks).
 */
export function sseResponse(frames: string[], error?: Error): Response {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        if (error) {
          setTimeout(() => controller.error(error), 0);
          return;
        }
        controller.close();
      },
    }),
  } as Response;
}

/** A fetch stub resolving with `response` on every call. */
export function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

/**
 * A fetch stub serving the given responses in order (cycling if there are
 * more calls than responses); `calls()` reports the call count.
 */
export function fetchQueue(responses: Response[]): {
  fetch: typeof fetch;
  calls: () => number;
} {
  let count = 0;
  return {
    fetch: (async () =>
      responses[count++ % responses.length]) as unknown as typeof fetch,
    calls: () => count,
  };
}

/** The single finished span, asserting exactly one was recorded. */
export function onlySpan(exporter: InMemorySpanExporter): ReadableSpan {
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  return spans[0];
}

/**
 * Asserts that neither any span attribute nor the status message carries
 * any of the forbidden texts (message text, provider bodies, keys).
 */
export function expectNoTextInSpan(
  span: {
    attributes: Record<string, unknown>;
    status: { message?: string };
  },
  forbidden: readonly string[],
): void {
  for (const [, value] of Object.entries(span.attributes)) {
    const text = String(value);
    for (const secret of forbidden) {
      expect(text).not.toContain(secret);
    }
  }
  for (const secret of forbidden) {
    expect(String(span.status.message)).not.toContain(secret);
  }
}
