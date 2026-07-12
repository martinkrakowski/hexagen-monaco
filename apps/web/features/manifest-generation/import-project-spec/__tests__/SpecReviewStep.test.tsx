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

describe("SpecReviewStep — conversion warnings gating", () => {
  const warning = "The conversion output appears to have been cut off…";

  test("shows conversion warnings on the conversion path", () => {
    const { container } = render(
      <SpecReviewStep
        specSummary={baseSummary}
        specContent=""
        cameFromConversion={true}
        conversionWarnings={[warning]}
        isJsonDisclosed={false}
        onToggleJsonDisclosed={() => {}}
      />,
    );
    assert.ok((container.textContent ?? "").includes(warning));
  });

  test("suppresses stale conversion warnings on a deterministic upload", () => {
    // cameFromConversion=false ⇒ a warning left over in state from a prior
    // conversion must NOT render for a structured-config upload (qodo #410).
    const { container } = render(
      <SpecReviewStep
        specSummary={baseSummary}
        specContent=""
        cameFromConversion={false}
        conversionWarnings={[warning]}
        isJsonDisclosed={false}
        onToggleJsonDisclosed={() => {}}
      />,
    );
    assert.ok(!(container.textContent ?? "").includes(warning));
  });
});
