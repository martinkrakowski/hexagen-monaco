import { describe, expect, it } from "vitest";
import { NullDecisionAdapter } from "../../src/infrastructure/adapters/null-decision.adapter";
import type { DecisionAdvicePort } from "../../src/application/ports/out/decision-advice.port";
import type { DecisionAdviceRequest } from "../../src/domain/decision-advice";

const request: DecisionAdviceRequest = {
  use: "context-type",
  fields: [{ name: "project", value: "bike-rental" }],
  questions: {
    c0: {
      type: "choice",
      instructions: "Classify bounded context c0 as one DDD context type.",
      criteria: { core: "Central business capability" },
    },
  },
};

describe("NullDecisionAdapter", () => {
  it("implements DecisionAdvicePort", () => {
    const adapter: DecisionAdvicePort = new NullDecisionAdapter();
    expect(adapter).toBeInstanceOf(NullDecisionAdapter);
  });

  it("always returns unknown/disabled, for any request", async () => {
    const adapter = new NullDecisionAdapter();
    await expect(adapter.ask(request)).resolves.toEqual({
      status: "unknown",
      reason: "disabled",
    });
    await expect(
      adapter.ask({ ...request, use: "template-select" }),
    ).resolves.toEqual({
      status: "unknown",
      reason: "disabled",
    });
  });
});
