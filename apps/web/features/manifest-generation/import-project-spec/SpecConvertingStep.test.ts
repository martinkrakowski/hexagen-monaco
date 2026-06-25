import { describe, it, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import * as React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { SpecConvertingStep } from "./SpecConvertingStep";

// React.createElement (not JSX) so the file matches the runner's **/*.test.ts
// glob — same reason as the other co-located .test.ts component tests.
const h = React.createElement;

describe("SpecConvertingStep", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("ticks an elapsed clock so a multi-minute wait does not read as a crash", () => {
    vi.useFakeTimers();
    render(h(SpecConvertingStep, { conversionError: null }));

    assert.match(
      screen.getByTestId("conversion-elapsed").textContent ?? "",
      /0:00 elapsed/,
    );
    // Reassurance copy is what tells the user it has not frozen.
    assert.match(document.body.textContent ?? "", /hasn.t frozen/);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    assert.match(
      screen.getByTestId("conversion-elapsed").textContent ?? "",
      /0:03 elapsed/,
    );
  });

  it("prefers the server liveness message over the default text", () => {
    render(
      h(SpecConvertingStep, {
        conversionError: null,
        progressMessage: "Model is processing your specification",
      }),
    );
    assert.match(
      document.body.textContent ?? "",
      /Model is processing your specification/,
    );
  });

  it("surfaces a conversion error inline", () => {
    render(
      h(SpecConvertingStep, {
        conversionError: "boom",
        progressMessage: null,
      }),
    );
    assert.match(document.body.textContent ?? "", /Error: boom/);
  });
});
