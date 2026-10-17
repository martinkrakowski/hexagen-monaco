// @vitest-environment node
/**
 * Jev J5a2 (brief step 4): the add-on materializer's U-C wiring in
 * wire.server. The real template-engine materializer runs (real templates,
 * real defaulting engine); only the Jev adapter is a fake, so the suite
 * observes what the composition actually does: with templateSuggest off no
 * advice is called and today's output stands; with it on the warning gains
 * the suggestion, the answer is unchanged, and a receipt is recorded per
 * suggestion (use "template-select", mode "shadow", today = the default).
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "@hexagen/agentic-interaction";
import {
  createBudgetedDecisionAdvice,
  markDecisionCallRecorded,
} from "../../../lib/decision-advice/budgeted-decision-advice";

const JEV_ENV_VARS = [
  "JEV_API_KEY",
  "JEV_CONTEXT_TYPE_MODE",
  "JEV_TEMPLATE_SUGGEST",
] as const;

const tracker = vi.hoisted(() => ({
  asks: [] as unknown[],
  choice: "2",
  recordCall: vi.fn<(call: unknown, answers: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@hexagen/agentic-interaction/server", () => ({
  JevDecisionAdapter: class {
    ask(request: unknown) {
      tracker.asks.push(request);
      return Promise.resolve({
        status: "advised",
        answers: {
          q0: {
            type: "choice",
            choice: tracker.choice,
            probabilities: { "0": 0.05, "1": 0.08, "2": 0.87 },
            confidence: 0.867,
          },
        },
        receipt: {
          use: "template-select",
          model: "typesafe/jev-1.14",
          requestId: "req-uc-1",
          generationId: "",
          status: "advised",
          costMicroUsd: 25,
          latencyMs: 200,
        },
      });
    }
  },
}));

vi.mock("../../../lib/platform", () => ({
  getPlatformStore: () => ({
    decisionReceipts: {
      recordCall: tracker.recordCall,
      spentSinceUtcMidnight: () => Promise.resolve(0),
    },
  }),
}));

import { getAddOnMaterializer } from "../wire.server";

// Today's output for this add-on selection, recorded from main (no Jev code
// ran): the defaulting warnings, and the answers the defaults produce.
const TODAY_WARNINGS = [
  "No answer supplied for 'framework'; used its default.",
  "No answer supplied for 'strict_validation'; used its default.",
  "No answer supplied for 'dotenv_tool'; used its default.",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const name of JEV_ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  tracker.asks.length = 0;
  tracker.choice = "2";
  tracker.recordCall.mockReset().mockResolvedValue({});
  // The unrecorded ledger starts (and stays) empty across tests.
  markDecisionCallRecorded("req-uc-1");
});

afterEach(() => {
  for (const name of JEV_ENV_VARS) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  markDecisionCallRecorded("req-uc-1");
});

const ASK: DecisionAdviceRequest = {
  use: "template-select",
  fields: [],
  questions: {},
};

test("with templateSuggest off no advice is called and the output is today's", async () => {
  process.env.JEV_API_KEY = "set";
  const { warnings, errors } = await getAddOnMaterializer().materialize(
    { "env-setup": {} },
    { projectName: "demo-app" },
  );

  expect(tracker.asks).toHaveLength(0);
  expect(errors).toEqual([]);
  expect(warnings).toEqual(TODAY_WARNINGS);
});

test("with templateSuggest on the warning gains the suggestion and the answer is unchanged", async () => {
  process.env.JEV_API_KEY = "set";
  process.env.JEV_TEMPLATE_SUGGEST = "on";
  const { warnings, errors, files } = await getAddOnMaterializer().materialize(
    { "env-setup": {} },
    { projectName: "demo-app" },
  );

  // The defaulting engine was consulted per defaulted select question.
  expect(tracker.asks.length).toBeGreaterThan(0);
  const request = tracker.asks[0] as DecisionAdviceRequest;
  expect(request.use).toBe("template-select");
  expect(request.questions.q0).toMatchObject({ type: "choice" });
  // Criteria are the option INDEXES mapped to the option texts; fields are
  // project / prompt / options.
  expect(Object.keys(request.questions.q0).length).toBeGreaterThan(0);
  expect(request.fields.map((f) => f.name)).toEqual([
    "project",
    "prompt",
    "options",
  ]);
  expect(request.fields[0]).toEqual({ name: "project", value: "demo-app" });

  expect(errors).toEqual([]);
  const dotenv = warnings.filter((w) => w.includes("'dotenv_tool'"));
  expect(dotenv).toHaveLength(1);
  expect(dotenv[0]).toBe(
    "No answer supplied for 'dotenv_tool'; used its default. " +
      "suggested: dotenv-expand (0.87)",
  );
  // The answer value never changed: load-env.ts is emitted only when the
  // dotenv_tool answer is dotenv / dotenv-expand, so it must NOT be emitted.
  expect([...files.keys()].some((f) => f.includes("config/load-env"))).toBe(
    false,
  );
});

test("with templateSuggest on a receipt is recorded per suggestion (shadow, today = the default)", async () => {
  process.env.JEV_API_KEY = "set";
  process.env.JEV_TEMPLATE_SUGGEST = "on";
  await getAddOnMaterializer().materialize(
    { "env-setup": {} },
    { projectName: "demo-app" },
  );

  expect(tracker.recordCall).toHaveBeenCalledTimes(tracker.asks.length);
  const [call, answers] = tracker.recordCall.mock.calls[0] as [
    Record<string, unknown>,
    Record<string, unknown>[],
  ];
  expect(call).toMatchObject({
    use: "template-select",
    status: "advised",
    model: "typesafe/jev-1.14",
    requestId: "req-uc-1",
    reviewer: false, // no JWT reaches materialization
    costMicroUsd: 25,
    latencyMs: 200,
  });
  expect(answers).toEqual([
    {
      questionIndex: 0,
      mode: "shadow",
      jevAnswer: "2",
      jevConfidence: 0.867,
      todayAnswer: "0", // the default option's index
      todaySource: "default",
      agreement: false,
    },
  ]);
  // The ledger entry for the recorded call is released once the write lands.
  const wrapper = createBudgetedDecisionAdvice({
    port: {
      ask: () =>
        Promise.resolve({
          status: "advised" as const,
          answers: {},
          receipt: {
            use: "template-select",
            model: "",
            requestId: "req-uc-1",
            generationId: "",
            status: "advised" as const,
            costMicroUsd: null,
            latencyMs: null,
          },
        }) satisfies Promise<DecisionAdviceResult>,
    },
    store: { spentSinceUtcMidnight: () => Promise.resolve(0) },
    maxCalls: 20,
    ceilingMicroUsd: 1000,
    callMaxMicroUsd: 1000,
  });
  await expect(wrapper.ask(ASK)).resolves.toMatchObject({ status: "advised" });
});

test("with templateSuggest on a non-first default records todayAnswer = its real index (docker.node_version default '22' = index 1)", async () => {
  process.env.JEV_API_KEY = "set";
  process.env.JEV_TEMPLATE_SUGGEST = "on";
  await getAddOnMaterializer().materialize(
    { docker: {} },
    { projectName: "demo-app" },
  );

  // docker's first defaulted select is node_version (options 20/22/23,
  // default "22" — index 1). The receipt's today side is that real index.
  expect(tracker.asks.length).toBeGreaterThan(0);
  const [, answers] = tracker.recordCall.mock.calls[0] as [
    Record<string, unknown>,
    Record<string, unknown>[],
  ];
  expect(answers).toEqual([
    {
      questionIndex: 0,
      mode: "shadow",
      jevAnswer: "2",
      jevConfidence: 0.867,
      todayAnswer: "1",
      todaySource: "default",
      agreement: false, // choice "2" ≠ default index 1
    },
  ]);

  // Agreement is true only when the choice IS the default index.
  tracker.asks.length = 0;
  tracker.choice = "1";
  const callsBefore = tracker.recordCall.mock.calls.length;
  await getAddOnMaterializer().materialize(
    { docker: {} },
    { projectName: "demo-app" },
  );
  const [, answers2] = tracker.recordCall.mock.calls[callsBefore] as [
    Record<string, unknown>,
    Record<string, unknown>[],
  ];
  expect(answers2).toEqual([
    {
      questionIndex: 0,
      mode: "shadow",
      jevAnswer: "1",
      jevConfidence: 0.867,
      todayAnswer: "1",
      todaySource: "default",
      agreement: true,
    },
  ]);
});
