// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createJevDecisionAdvice } from "../wire.server";

/**
 * Jev J5a1, brief step 3: the wire factory's env parsing and the
 * null-without-key case. Node environment; the platform store resolves to
 * `:memory:` under NODE_ENV=test, so the receipts store the budgeted wrapper
 * binds is inert here.
 *
 * The key itself is never printed or logged anywhere in this suite: only its
 * PRESENCE is asserted.
 */

const ENV_KEYS = [
  "JEV_API_KEY",
  "JEV_CONTEXT_TYPE_MODE",
  "JEV_CONTEXT_TYPE_MIN_CONFIDENCE",
  "JEV_MAX_CALLS_PER_GENERATION",
  "JEV_DAILY_COST_CEILING_USD",
  "JEV_TEMPLATE_SUGGEST",
  "JEV_REVIEWER_SUB",
] as const;

const savedEnv: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function withEnv(over: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(over)) {
    process.env[key] = value;
  }
}

describe("createJevDecisionAdvice (invariant 1)", () => {
  it("returns null without JEV_API_KEY — Jev is off by default", () => {
    withEnv({});
    expect(createJevDecisionAdvice()).toBeNull();
  });

  it("returns null when JEV_API_KEY is whitespace only", () => {
    withEnv({ JEV_API_KEY: "   " });
    expect(createJevDecisionAdvice()).toBeNull();
  });

  it("activates on defaults with defaults-only env", () => {
    withEnv({ JEV_API_KEY: "test-only-key" });
    const config = createJevDecisionAdvice();
    expect(config).not.toBeNull();
    expect(config?.contextTypeMode).toBe("off");
    expect(config?.minConfidence).toBe(0.8);
    expect(config?.templateSuggest).toBe(false);
    expect(config?.reviewerSub).toBe("");
  });

  it.each([
    ["shadow", "shadow"],
    ["primary", "primary"],
    ["off", "off"],
    // Anything else stays off — a typo must never widen what Jev may do.
    ["PRIMARY", "off"],
    ["yes", "off"],
    ["", "off"],
  ])("JEV_CONTEXT_TYPE_MODE=%p parses to %p", (raw, expected) => {
    withEnv({ JEV_API_KEY: "test-only-key", JEV_CONTEXT_TYPE_MODE: raw });
    expect(createJevDecisionAdvice()?.contextTypeMode).toBe(expected);
  });

  it("clamps JEV_CONTEXT_TYPE_MIN_CONFIDENCE into 0..1", () => {
    withEnv({
      JEV_API_KEY: "test-only-key",
      JEV_CONTEXT_TYPE_MIN_CONFIDENCE: "1.5",
    });
    expect(createJevDecisionAdvice()?.minConfidence).toBe(1);
    withEnv({
      JEV_API_KEY: "test-only-key",
      JEV_CONTEXT_TYPE_MIN_CONFIDENCE: "-2",
    });
    expect(createJevDecisionAdvice()?.minConfidence).toBe(0.8); // negative is malformed, never 0
  });

  it.each([
    ["", 0.8], // empty = unset → default
    ["abc", 0.8], // malformed → default, never NaN
    ["0.5", 0.5],
  ])("JEV_CONTEXT_TYPE_MIN_CONFIDENCE=%p parses to %p", (raw, expected) => {
    withEnv({
      JEV_API_KEY: "test-only-key",
      JEV_CONTEXT_TYPE_MIN_CONFIDENCE: raw,
    });
    expect(createJevDecisionAdvice()?.minConfidence).toBe(expected);
  });

  it("JEV_TEMPLATE_SUGGEST is on only for the literal 'on'", () => {
    withEnv({ JEV_API_KEY: "test-only-key", JEV_TEMPLATE_SUGGEST: "on" });
    expect(createJevDecisionAdvice()?.templateSuggest).toBe(true);
    withEnv({ JEV_API_KEY: "test-only-key", JEV_TEMPLATE_SUGGEST: "true" });
    expect(createJevDecisionAdvice()?.templateSuggest).toBe(false);
  });

  it("JEV_REVIEWER_SUB passes through verbatim, empty allowed", () => {
    withEnv({
      JEV_API_KEY: "test-only-key",
      JEV_REVIEWER_SUB: "owner-sub-1",
    });
    expect(createJevDecisionAdvice()?.reviewerSub).toBe("owner-sub-1");
    withEnv({ JEV_API_KEY: "test-only-key", JEV_REVIEWER_SUB: "" });
    expect(createJevDecisionAdvice()?.reviewerSub).toBe("");
  });

  it("the max-calls cap actually governs the port (wrapper behaviour)", async () => {
    withEnv({
      JEV_API_KEY: "test-only-key",
      JEV_MAX_CALLS_PER_GENERATION: "1",
    });
    const config = createJevDecisionAdvice();
    const request = {
      use: "context-type",
      // A secret-shaped field makes buildState refuse before any fetch, so
      // the first ask resolves locally (unknown/refused): no network here.
      fields: [
        { name: "f", value: ["sk-or-", "v1-", "0123456789abcdef"].join("") },
      ],
      questions: {
        c0: { type: "choice", instructions: "", criteria: { core: "c" } },
      },
    } as const;
    const first = await config?.port.ask(request);
    // The first ask passes the budget and is refused by the state builder;
    // the SECOND is refused by the budget, before any dispatch.
    expect(first).toMatchObject({ status: "unknown", reason: "refused" });
    const second = await config?.port.ask(request);
    expect(second).toEqual({ status: "unknown", reason: "budget" });
  });
});
