import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProjectScanResponse } from "@/lib/project-scan/types";
import { Report } from "./Report";
import type { ReportProps } from "./Report";

// jsdom implements neither method on <dialog>. Same polyfill the sibling
// GateInstall tests use -- without it the container's open effect throws
// and the failure looks like a container bug rather than a jsdom gap.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

// jest-dom is NOT registered by apps/web/vitest.setup.ts — toBeTruthy(),
// toBeNull() and getAttribute() only. React is not imported: the Vitest config
// compiles JSX with the automatic runtime and an unused binding is a
// pre-commit ESLint error.

function cleanScan(): ProjectScanResponse {
  return {
    verdict: "pass",
    exitCode: 0,
    projectName: "Acme Checkout",
    layoutExcerpt: null,
    filesScanned: 412,
    reportMarkdown: null,
    errorMessage: null,
    findings: {
      collected: true,
      fresh: [],
      baselined: [],
      stale: [],
      expired: [],
    },
  };
}

function renderContainer(overrides: Partial<ReportProps> = {}) {
  const handlers = {
    onInstallGate: vi.fn(),
    onGateDelivered: vi.fn(),
    onExit: vi.fn(),
  };
  render(
    <Report
      scan={cleanScan()}
      scanId="Acme-Checkout-k9"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("Report (S6 container)", () => {
  it("states the outcome and offers an explicit install", () => {
    renderContainer();

    expect(document.body.textContent).toMatch(/Nothing is failing the gate/);
    expect(
      screen.getByRole("button", { name: "Install the gate" }),
    ).toBeTruthy();
  });

  it("NEVER navigates on arrival — the user leaves by pressing something", () => {
    const handlers = renderContainer();

    expect(handlers.onExit).not.toHaveBeenCalled();
    expect(handlers.onInstallGate).not.toHaveBeenCalled();
  });

  it("raises INSTALL_GATE on the same click that opens the dialog", async () => {
    const user = userEvent.setup();
    const handlers = renderContainer();

    await user.click(screen.getByRole("button", { name: "Install the gate" }));

    expect(handlers.onInstallGate).toHaveBeenCalledTimes(1);
    // Entering S7 is not leaving the flow.
    expect(handlers.onExit).not.toHaveBeenCalled();
  });

  it("blocks the installer when the scan produced nothing to install from", () => {
    // A Tier-A handoff has no findings list at all, which is this arm. The gate
    // writes a baseline into somebody's repository; doing that from an
    // unmeasured scan is the defect the whole contract exists to prevent.
    const handlers = renderContainer({
      scan: { ...cleanScan(), findings: null },
    });

    const button = screen.getByRole("button", {
      name: "Install the gate",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(handlers.onInstallGate).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(
      /An absent list is not an empty one/,
    );
  });

  it("blocks the installer when the scan could not run", () => {
    const button = renderAndFindInstall({
      ...cleanScan(),
      verdict: "could-not-run",
      errorMessage: "hexagen was not on PATH",
    });

    expect(button.disabled).toBe(true);
  });

  it("shows no count pills for an untrustworthy scan", () => {
    // Four zeroes under a heading saying the scan did not report IS the false
    // green; `buildScanReport` suppresses the pills and the view must not
    // re-derive them.
    renderContainer({ scan: { ...cleanScan(), findings: null } });

    expect(document.body.textContent).not.toMatch(/failing the gate\s*0/);
  });

  it("leaves the flow only through the explicit exit action", async () => {
    const user = userEvent.setup();
    const handlers = renderContainer();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(handlers.onExit).toHaveBeenCalledTimes(1);
  });
});

function renderAndFindInstall(scan: ProjectScanResponse): HTMLButtonElement {
  renderContainer({ scan });
  return screen.getByRole("button", {
    name: "Install the gate",
  }) as HTMLButtonElement;
}
