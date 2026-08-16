/**
 * Adapter tests for {@link LlmSuggestionAdapter}.
 *
 * Only the no-key branch is exercised here, and deliberately so: it is the one
 * branch that reaches a decision without a network call. A test that mocked
 * `@hexagen/agentic-interaction` to assert "the adapter calls the LLM stack"
 * would assert nothing but the mock — the adapter's only remaining job on that
 * path IS constructing that stack. What the adapter does with the use case's
 * two results is covered where it is observable: the handler tests, driven
 * through the port with both outcomes.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { LlmSuggestionAdapter } from "../llm-suggestion.adapter";

describe("LlmSuggestionAdapter", () => {
  it("reports a missing API key as unavailable rather than an empty suggestion list", async () => {
    const adapter = new LlmSuggestionAdapter(() => "");

    const outcome = await adapter.suggest({
      manifestYaml: "bounded_contexts: []",
    });

    assert.deepEqual(outcome, {
      kind: "unavailable",
      // Pinned: `useGovernanceData` puts this string straight into the
      // governance panel's error banner.
      reason: "LLM API key not configured",
    });
  });

  it("does not read provider env vars before deciding the key is missing", async () => {
    // Ordering matters: resolving baseUrl/model first would make an
    // unconfigured deployment construct a provider it can never call.
    const seen: string[] = [];
    const adapter = new LlmSuggestionAdapter(
      () => "",
      (name) => {
        seen.push(name);
        return undefined;
      },
    );

    await adapter.suggest({ manifestYaml: "bounded_contexts: []" });

    assert.deepEqual(seen, []);
  });
});
