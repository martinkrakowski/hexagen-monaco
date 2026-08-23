import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ScanFindings } from "@/lib/project-scan/types";
import { FindingsReview } from "./FindingsReview";
import type { FindingsReviewProps } from "./FindingsReview";

// jest-dom is NOT registered by apps/web/vitest.setup.ts — toBeTruthy(),
// toBeNull() and getAttribute() only. React is not imported: the Vitest config
// compiles JSX with the automatic runtime and an unused binding is a
// pre-commit ESLint error.

const NOW = new Date("2026-08-20T12:00:00.000Z");

function collected(): ScanFindings {
  return {
    collected: true,
    fresh: [
      {
        rule: "npm-package-in-domain",
        file: "packages/orders/src/domain/order.ts",
        specifier: "zod",
        message: "npm package in domain layer",
      },
      {
        rule: "server-marker-missing",
        file: "packages/billing/src/infra/db.ts",
        specifier: "",
        message: "missing server-only marker",
      },
    ],
    baselined: [],
    stale: [],
    expired: [],
  };
}

function renderContainer(overrides: Partial<FindingsReviewProps> = {}) {
  const handlers = {
    onDecisionsChange: vi.fn(),
    onRatify: vi.fn(),
    onBack: vi.fn(),
  };
  render(
    <FindingsReview
      findings={collected()}
      projectName="Acme Checkout"
      now={NOW}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("FindingsReview (S5 container)", () => {
  it("renders the review behind the shell's footer actions", () => {
    renderContainer();

    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });

  it("hands the host the decision, and never navigates itself", async () => {
    const user = userEvent.setup();
    const handlers = renderContainer();

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(handlers.onRatify).toHaveBeenCalledTimes(1);
    // Nothing accepted yet, so the decision list is empty and every finding
    // keeps failing the gate. An empty list is the CORRECT ratification here.
    expect(handlers.onRatify.mock.calls[0][0]).toEqual([]);
  });

  it("persists KEYS rather than the findings themselves", async () => {
    // BF-3.4 drops the findings on purpose — they are a point-in-time copy of
    // somebody's repository. What survives a refresh is the user's decision.
    const user = userEvent.setup();
    const handlers = renderContainer();

    // Only the largest rule group is open on arrival, so the row controls are
    // reached by their accessible name rather than by "every checkbox".
    const accept = screen.getAllByLabelText(/as pre-existing debt$/)[0];
    await user.click(accept);

    // Ticked but not yet justified: not a writable decision, so not yet
    // persisted. See the container docblock — this is stated behaviour.
    expect(handlers.onDecisionsChange).toHaveBeenCalled();
    expect(handlers.onDecisionsChange.mock.calls.at(-1)?.[0]).toEqual([]);

    const reason = screen.getAllByLabelText(/is accepted debt/)[0];
    await user.type(reason, "carrier type, ADR-0054");

    const keys = handlers.onDecisionsChange.mock.calls.at(-1)?.[0];
    expect(keys).toHaveLength(1);
    expect(typeof keys[0]).toBe("string");
  });

  it("refuses to ratify a scan whose findings were never reported", () => {
    // The false green this whole contract exists to prevent: no findings list
    // is not a clean tree, so Continue must be dead and must say why.
    renderContainer({ findings: null });

    const button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.body.textContent).toMatch(/not the same as a clean tree/);
  });

  it("refuses to ratify a scan whose findings could not be collected", () => {
    renderContainer({
      findings: {
        collected: false,
        failureReason: "hexagen-lint was not on PATH",
        fresh: [],
        baselined: [],
        stale: [],
        expired: [],
      },
    });

    const button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.body.textContent).toMatch(/hexagen-lint was not on PATH/);
  });

  it("raises Back as an intent rather than routing", async () => {
    const user = userEvent.setup();
    const handlers = renderContainer();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onRatify).not.toHaveBeenCalled();
  });
});
