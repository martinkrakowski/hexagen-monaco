import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JevDecisionAdapter } from "../../src/infrastructure/adapters/jev-decision.adapter";
import type { DecisionAdvicePort } from "../../src/application/ports/out/decision-advice.port";
import type {
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "../../src/domain/decision-advice";
import type { SecretVaultPort } from "../../src/domain/provider-config";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, "../use-cases/staged-generation/fixtures/jev");

const contextTypeResponse = JSON.parse(
  readFileSync(resolve(fixtureDir, "jev-context-type-response.json"), "utf8"),
) as unknown;
const templateResponse = JSON.parse(
  readFileSync(
    resolve(fixtureDir, "jev-template-select-response.json"),
    "utf8",
  ),
) as unknown;

const contextTypeRequest: DecisionAdviceRequest = {
  use: "context-type",
  fields: [
    { name: "project", value: "bike-rental" },
    {
      name: "c0",
      value: "name: Rentals; responsibility: book bikes for a time slot",
    },
  ],
  questions: {
    c0: {
      type: "choice",
      instructions: "Classify bounded context c0 as one DDD context type.",
      criteria: {
        core: "Central business capability, primary revenue driver",
        supporting: "Augments a core context but is not the primary business",
        generic: "General-purpose capability usable across any domain",
        "shared-kernel": "Shared data contract or event vocabulary",
        driver: "Outer-ring context integrating an external system",
      },
    },
    c1: {
      type: "choice",
      instructions: "Classify bounded context c1 as one DDD context type.",
      criteria: {
        core: "Central business capability, primary revenue driver",
        supporting: "Augments a core context but is not the primary business",
        generic: "General-purpose capability usable across any domain",
        "shared-kernel": "Shared data contract or event vocabulary",
        driver: "Outer-ring context integrating an external system",
      },
    },
  },
};

const templateRequest: DecisionAdviceRequest = {
  use: "template-select",
  fields: [],
  questions: {
    q0: {
      type: "choice",
      instructions: "Pick the option that best fits this project.",
      criteria: { "0": "dotenv", "1": "dotenv-flow", "2": "none" },
    },
  },
};

const KEY = "sk-or-v1-jev-test-key-DO-NOT-LEAK";

function vault(key: string | null): SecretVaultPort {
  return { getSecret: (_name: string) => key };
}

/** A fake fetch serving a canned JSON response, recording the request. */
function fetchServing(
  body: unknown,
  response: { status?: number } = {},
): { fetch: typeof globalThis.fetch; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const fetch = ((_url: unknown, init?: RequestInit) => {
    calls.push(init ?? {});
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: response.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function adapterWith(
  fetchImpl: typeof globalThis.fetch,
  key: string | null = KEY,
): JevDecisionAdapter {
  return new JevDecisionAdapter({
    secretVault: vault(key),
    fetch: fetchImpl,
    timeoutMs: 3000,
  });
}

/** The key string must never leak into any result, receipt or thrown message. */
function expectNoKey(result: DecisionAdviceResult): void {
  const serialized = JSON.stringify(result);
  expect(serialized).toBeDefined();
  expect(serialized).not.toContain(KEY);
}

describe("JevDecisionAdapter", () => {
  let fetch: typeof globalThis.fetch;

  beforeEach(() => {
    fetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetch;
    vi.useRealTimers();
  });

  it("implements DecisionAdvicePort", () => {
    const { fetch: fake } = fetchServing(contextTypeResponse);
    const adapter: DecisionAdvicePort = adapterWith(fake);
    expect(adapter).toBeInstanceOf(JevDecisionAdapter);
  });

  it("advises for the context-type fixture", async () => {
    const { fetch: fake, calls } = fetchServing(contextTypeResponse);
    const result = await adapterWith(fake).ask(contextTypeRequest);

    expect(result.status).toBe("advised");
    if (result.status !== "advised") return;
    const c0 = result.answers["c0"];
    const c1 = result.answers["c1"];
    expect(c0).toEqual({
      type: "choice",
      choice: "core",
      probabilities: {
        core: 1,
        supporting: 0,
        generic: 0,
        "shared-kernel": 0,
        driver: 0,
      },
      confidence: 1,
    });
    expect(c1).toEqual({
      type: "choice",
      choice: "supporting",
      probabilities: {
        core: 0,
        supporting: 0.56,
        generic: 0.17,
        "shared-kernel": 0,
        driver: 0.27,
      },
      confidence: 0.45,
    });
    // Receipt: model and request id as reported, cost in micro-USD, no state.
    expect(result.receipt.model).toBe("typesafe/jev-1.14-20261014");
    expect(result.receipt.requestId).toBe(
      "gen-dec-1792209057-YWSD4tAfztlHGa3TroHD",
    );
    expect(result.receipt.use).toBe("context-type");
    expect(result.receipt.status).toBe("advised");
    expect(result.receipt.costMicroUsd).toBe(27); // 0.000027048 USD
    expect(result.receipt.latencyMs).toBeTypeOf("number");
    expectNoKey(result);

    // The wire request: POST, no redirects, the key in the auth header only.
    expect(calls).toHaveLength(1);
    const init = calls[0] as {
      method?: string;
      redirect?: string;
      headers?: Record<string, string>;
      body?: string;
    };
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers?.["authorization"]).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body ?? "{}")).toMatchObject({
      model: "typesafe/jev-1.14",
      questions: contextTypeRequest.questions,
    });
  });

  it("advises for the template-select fixture", async () => {
    const { fetch: fake } = fetchServing(templateResponse);
    const result = await adapterWith(fake).ask(templateRequest);

    expect(result.status).toBe("advised");
    if (result.status !== "advised") return;
    expect(result.answers["q0"]).toEqual({
      type: "choice",
      choice: "0",
      probabilities: { "0": 0.59, "1": 0.34, "2": 0.07 },
      confidence: 0.38,
    });
    expect(result.receipt.costMicroUsd).toBe(15); // 0.000014994 USD
    expect(result.receipt.requestId).toBe(
      "gen-dec-1792209058-kpzK3WTjUhiSXCX5VHyi",
    );
    expectNoKey(result);
  });

  it("maps a 500 to unknown/http", async () => {
    const { fetch: fake } = fetchServing({ error: "boom" }, { status: 500 });
    const result = await adapterWith(fake).ask(contextTypeRequest);
    expect(result.status).toBe("unknown");
    expect(result).toMatchObject({ status: "unknown", reason: "http" });
    if (result.status === "unknown") {
      expect(result.receipt?.status).toBe("http");
      expect(result.receipt?.latencyMs).toBeTypeOf("number");
    }
    expectNoKey(result);
  });

  it("maps a deadline over both request and body read to unknown/timeout", async () => {
    vi.useFakeTimers();
    const never = ((_url: unknown, _init?: RequestInit) =>
      new Promise<Response>(() => {})) as typeof globalThis.fetch;
    const adapter = adapterWith(never);
    const promise = adapter.ask(contextTypeRequest);

    await vi.advanceTimersByTimeAsync(3000);

    const result = await promise;
    expect(result).toMatchObject({ status: "unknown", reason: "timeout" });
    expectNoKey(result);
  });

  it("cuts a body past 64 KiB at unknown/shape", async () => {
    // Valid JSON, but larger than the 64 KiB cap.
    const huge = { answers: { c0: { padding: "x".repeat(70 * 1024) } } };
    const { fetch: fake } = fetchServing(huge);
    const result = await adapterWith(fake).ask(contextTypeRequest);
    expect(result).toMatchObject({ status: "unknown", reason: "shape" });
    expectNoKey(result);
  });

  it("maps a redirect (fetch rejects with TypeError) to unknown/http", async () => {
    const redirect = (() =>
      Promise.reject(
        new TypeError("fetch: redirect"),
      )) as typeof globalThis.fetch;
    const result = await adapterWith(redirect).ask(contextTypeRequest);
    expect(result).toMatchObject({ status: "unknown", reason: "http" });
    expectNoKey(result);
  });

  it("returns unknown/disabled and never calls out without the key", async () => {
    let called = false;
    const spy = (() => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof globalThis.fetch;
    const result = await adapterWith(spy, null).ask(contextTypeRequest);

    expect(result).toEqual({ status: "unknown", reason: "disabled" });
    expect(called).toBe(false);
  });

  it("maps bad JSON to unknown/shape", async () => {
    const fetch = (() =>
      Promise.resolve(
        new Response("not json at all", { status: 200 }),
      )) as typeof globalThis.fetch;
    const result = await adapterWith(fetch).ask(contextTypeRequest);
    expect(result).toMatchObject({ status: "unknown", reason: "shape" });
    expectNoKey(result);
  });

  it("maps a tie answer to unknown/tie", async () => {
    const tie = {
      answers: {
        c0: {
          type: "choice",
          choice: "core",
          probabilities: {
            core: 0.5,
            supporting: 0.5,
            generic: 0,
            "shared-kernel": 0,
            driver: 0,
          },
          confidence: 0.5,
        },
        c1: {
          type: "choice",
          choice: "core",
          probabilities: {
            core: 1,
            supporting: 0,
            generic: 0,
            "shared-kernel": 0,
            driver: 0,
          },
          confidence: 1,
        },
      },
      model: "typesafe/jev-1.14-20261014",
      usage: { cost: 0.000027 },
    };
    const { fetch: fake } = fetchServing(tie);
    const result = await adapterWith(fake).ask(contextTypeRequest);
    expect(result).toMatchObject({ status: "unknown", reason: "tie" });
    expectNoKey(result);
  });

  it("never puts the key in any result or thrown message", async () => {
    // Every path above already asserts this; one aggregate sweep over all
    // failure fetches as belt-and-braces.
    const fetches: Array<typeof globalThis.fetch> = [
      fetchServing({ answers: "nope" }).fetch,
      (() =>
        Promise.reject(new Error("network down"))) as typeof globalThis.fetch,
    ];
    for (const fake of fetches) {
      const result = await adapterWith(fake).ask(contextTypeRequest);
      expectNoKey(result);
    }
  });
});

describe("JevDecisionAdapter hardening (review of #881)", () => {
  it("ends at the deadline when the body stream never delivers and ignores the signal", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
    });
    const adapter = new JevDecisionAdapter({
      secretVault: { getSecret: () => "test-key" } as never,
      fetch: (async () =>
        new Response(stalled, { status: 200 })) as typeof fetch,
      timeoutMs: 30,
    });
    const result = await adapter.ask(contextTypeRequest);
    expect(result).toMatchObject({ status: "unknown", reason: "timeout" });
  });

  it("never throws when the injected fetch throws synchronously", async () => {
    const adapter = new JevDecisionAdapter({
      secretVault: { getSecret: () => "test-key" } as never,
      fetch: (() => {
        throw new Error("sync boom test-key");
      }) as unknown as typeof fetch,
      timeoutMs: 30,
    });
    const result = await adapter.ask(contextTypeRequest);
    expect(result).toEqual({ status: "unknown", reason: "error" });
    expect(JSON.stringify(result)).not.toContain("test-key");
  });
});
