/**
 * Behavioural pins for the cloud pipeline's provider chain, wired through
 * `createLLMSender`.
 *
 * ADR-0051 §Decision 4 makes one of these load-bearing: "The
 * no-`cloudConfig.fallbackChain` default path must stay behaviorally covered
 * by a test." Before this file, the only wire.server suite exercised
 * `"in-memory"` mode only — the cloud default arm had zero coverage.
 *
 * The pins are behavioural, not structural: they drive a real
 * `CloudLLMPipelineAdapter` through `sendRequest` against a stubbed `fetch`
 * and assert on the HTTP call that comes out (URL, model, sampling params,
 * Authorization). A chain source that returned a different endpoint, model or
 * key-env-var therefore fails here even if it type-checks.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { LLMRequest } from "@hexagen/local-llm";
import type {
  ProviderCatalogPort,
  ProviderFallbackChain,
} from "@hexagen/agentic-interaction";
import { createLLMSender } from "./wire.server";

interface CapturedCall {
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

const captured: CapturedCall[] = [];

const realFetch = globalThis.fetch;

/**
 * Replaces `globalThis.fetch` with a scripted sequence of responses. The
 * adapter captures `globalThis.fetch` in its constructor, so this must be
 * installed before `createLLMSender` runs.
 *
 * Assigns directly rather than via `vi.stubGlobal`, and the paired teardown
 * restores `realFetch` by hand. Historically this shape was mandatory: the
 * setup installed its in-memory `localStorage`/`sessionStorage` with
 * `vi.stubGlobal`, so a `vi.unstubAllGlobals()` also tore those down and the
 * setup's own `afterEach` hit the host's throwing storage. The setup now owns
 * those globals outside Vitest's stub registry (apps/web/vitest.setup.test.ts
 * pins that), so this is simply a suite restoring what it replaced.
 */
function stubFetchSequence(
  responses: Array<{ status: number; content?: string }>,
): void {
  let call = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured.push({
      url: String(input),
      authorization: headers.get("Authorization") ?? undefined,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const scripted = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    if (scripted.status !== 200) {
      return new Response("upstream said no", { status: scripted.status });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: scripted.content ?? "{}" },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
}

function aRequest(): LLMRequest {
  return {
    id: "llm-req-test",
    modelId: "gpt-4o-mini" as LLMRequest["modelId"],
    messages: [{ role: "user", content: "ping" }],
    schema: z.object({}),
  };
}

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLM_API_KEY",
  "INCEPTION_API_KEY",
] as const;

const savedEnv = new Map<string, string | undefined>();

describe("createLLMSender — cloud provider chain", () => {
  beforeEach(() => {
    captured.length = 0;
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of ENV_KEYS) {
      const previous = savedEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  describe("no cloudConfig.fallbackChain (the default path)", () => {
    it("routes to the OpenAI endpoint on gpt-4o-mini, keyed by OPENAI_API_KEY", async () => {
      process.env.OPENAI_API_KEY = "sk-default-path";
      stubFetchSequence([{ status: 200 }]);

      const sender = createLLMSender("cloud");
      const result = await sender.sendRequest(aRequest());

      expect(result.success).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0]!.url).toBe(
        "https://api.openai.com/v1/chat/completions",
      );
      expect(captured[0]!.body.model).toBe("gpt-4o-mini");
      expect(captured[0]!.authorization).toBe("Bearer sk-default-path");
      // Sampling params come from the chain endpoint, not from the request
      // (which sets neither) — so these pin the endpoint's own configuration.
      expect(captured[0]!.body.temperature).toBe(0.4);
      expect(captured[0]!.body.max_tokens).toBe(4096);
    });

    it("falls back to gpt-3.5-turbo on the same key when the primary is retryable", async () => {
      process.env.OPENAI_API_KEY = "sk-default-path";
      // 429 is retryable -> the adapter advances to the next resolved provider.
      stubFetchSequence([{ status: 429 }, { status: 200 }]);

      const sender = createLLMSender("cloud");
      const result = await sender.sendRequest(aRequest());

      expect(result.success).toBe(true);
      expect(captured.map((c) => c.body.model)).toEqual([
        "gpt-4o-mini",
        "gpt-3.5-turbo",
      ]);
      expect(captured.map((c) => c.url)).toEqual([
        "https://api.openai.com/v1/chat/completions",
        "https://api.openai.com/v1/chat/completions",
      ]);
      expect(captured[1]!.authorization).toBe("Bearer sk-default-path");
    });

    it("resolves nothing — and issues no HTTP call — when OPENAI_API_KEY is unset", async () => {
      stubFetchSequence([{ status: 200 }]);

      const sender = createLLMSender("cloud");
      const result = await sender.sendRequest(aRequest());

      expect(result.success).toBe(false);
      expect(captured).toHaveLength(0);
      // Pins that the default chain is keyed on OPENAI_API_KEY specifically:
      // a chain keyed on some other env var would also produce zero calls
      // here, but would then fail the first two cases.
      expect(
        result.success
          ? ""
          : String((result as { error: Error }).error.message),
      ).toMatch(/No cloud LLM API keys configured/);
    });
  });

  describe("the default path reads the injected catalog, not a literal", () => {
    // The three cases above pin the *values* of the default chain. They would
    // all still pass against a wire.server that ignored the catalog port and
    // re-hard-coded those same values inline — which is exactly the regression
    // item 5.3(b) exists to prevent. This case closes that hole: it injects a
    // catalog whose chain shares no field with the real default, and asserts
    // the wire followed it.
    it("uses the chain the injected ProviderCatalogPort returns", async () => {
      process.env.OPENAI_API_KEY = "sk-real-default";
      process.env.LLM_API_KEY = "sk-sentinel";
      stubFetchSequence([{ status: 200 }]);

      let calls = 0;
      const sentinelCatalog: ProviderCatalogPort = {
        createDefaultChain: () => {
          calls += 1;
          return {
            primary: {
              providerId: "openai",
              baseUrl: "https://sentinel.example/v1",
              model: "sentinel-model",
              apiKeyEnvVar: "LLM_API_KEY",
            },
            fallbacks: [],
          };
        },
      };

      const sender = createLLMSender("cloud", {
        providerCatalog: sentinelCatalog,
      });
      await sender.sendRequest(aRequest());

      expect(calls).toBe(1);
      expect(captured).toHaveLength(1);
      expect(captured[0]!.url).toBe(
        "https://sentinel.example/v1/chat/completions",
      );
      expect(captured[0]!.body.model).toBe("sentinel-model");
      expect(captured[0]!.authorization).toBe("Bearer sk-sentinel");
    });

    it("does not consult the catalog when an explicit chain is supplied", async () => {
      process.env.LLM_API_KEY = "sk-explicit";
      stubFetchSequence([{ status: 200 }]);

      let calls = 0;
      const countingCatalog: ProviderCatalogPort = {
        createDefaultChain: () => {
          calls += 1;
          throw new Error("catalog must not be consulted on the explicit path");
        },
      };

      const sender = createLLMSender("cloud", {
        providerCatalog: countingCatalog,
        fallbackChain: {
          primary: {
            providerId: "openai",
            baseUrl: "https://explicit.example/v1",
            model: "explicit-model",
            apiKeyEnvVar: "LLM_API_KEY",
          },
          fallbacks: [],
        },
      });
      await sender.sendRequest(aRequest());

      expect(calls).toBe(0);
      expect(captured[0]!.body.model).toBe("explicit-model");
    });

    it("does not consult the catalog in in-memory mode", async () => {
      stubFetchSequence([{ status: 200 }]);

      let calls = 0;
      const countingCatalog: ProviderCatalogPort = {
        createDefaultChain: () => {
          calls += 1;
          throw new Error("catalog must not be consulted in in-memory mode");
        },
      };

      const sender = createLLMSender("in-memory", {
        providerCatalog: countingCatalog,
      });
      await sender.sendRequest(aRequest());

      expect(calls).toBe(0);
      expect(captured).toHaveLength(0);
    });
  });

  describe("explicit cloudConfig.fallbackChain", () => {
    it("is used verbatim and does not fall back to the default chain", async () => {
      process.env.OPENAI_API_KEY = "sk-should-not-be-used";
      process.env.LLM_API_KEY = "sk-explicit";
      stubFetchSequence([{ status: 200 }]);

      const explicit: ProviderFallbackChain = {
        primary: {
          providerId: "openai",
          baseUrl: "https://explicit.example/v1",
          model: "explicit-model",
          apiKeyEnvVar: "LLM_API_KEY",
          temperature: 0.1,
          maxTokens: 128,
        },
        fallbacks: [],
      };

      const sender = createLLMSender("cloud", { fallbackChain: explicit });
      await sender.sendRequest(aRequest());

      expect(captured).toHaveLength(1);
      expect(captured[0]!.url).toBe(
        "https://explicit.example/v1/chat/completions",
      );
      expect(captured[0]!.body.model).toBe("explicit-model");
      expect(captured[0]!.authorization).toBe("Bearer sk-explicit");
    });
  });

  describe("in-memory mode", () => {
    it("issues no HTTP call at all", async () => {
      process.env.OPENAI_API_KEY = "sk-default-path";
      stubFetchSequence([{ status: 200 }]);

      const sender = createLLMSender("in-memory");
      await sender.sendRequest(aRequest());

      expect(captured).toHaveLength(0);
    });
  });
});
