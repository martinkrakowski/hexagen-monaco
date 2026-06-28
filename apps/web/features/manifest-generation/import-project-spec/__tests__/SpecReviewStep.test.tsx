import React from "react";
import { test, describe, afterEach } from "vitest";
import assert from "node:assert";
import { render, cleanup } from "@testing-library/react";
import { SpecReviewStep } from "../SpecReviewStep";
import type { SpecSummary } from "../utils";

afterEach(cleanup);

const baseSummary: SpecSummary = {
  contextCount: 3,
  aggregateCount: 2,
  valueObjectCount: 1,
  useCaseCount: 4,
  mappingCount: 0,
  eventBusSubscriptionCount: 0,
};

function renderStep(summary: SpecSummary | null) {
  // The advisory text is interrupted by a <code> element, so RTL's getByText
  // (which matches per-element node text) can't see the full run; assert on the
  // container's flattened textContent instead.
  return render(
    <SpecReviewStep
      specSummary={summary}
      specContent=""
      cameFromConversion={false}
      isJsonDisclosed={false}
      onToggleJsonDisclosed={() => {}}
    />,
  );
}

describe("SpecReviewStep — no-aggregates advisory", () => {
  test("shows the R17 advisory when 0 aggregates are detected", () => {
    const { container } = renderStep({ ...baseSummary, aggregateCount: 0 });
    const text = container.textContent ?? "";
    assert.ok(
      /no aggregates were detected/i.test(text),
      "expected the no-aggregates advisory",
    );
    assert.ok(
      text.includes("R17"),
      "advisory should reference R17 (the rule the user sees in findings)",
    );
  });

  test("hides the advisory when aggregates are present", () => {
    const { container } = renderStep({ ...baseSummary, aggregateCount: 2 });
    const text = container.textContent ?? "";
    assert.ok(
      !/no aggregates were detected/i.test(text),
      "advisory must not show when aggregates exist",
    );
  });
});
