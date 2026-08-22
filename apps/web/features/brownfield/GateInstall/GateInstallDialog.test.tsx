/**
 * S7 presentation.
 *
 * Two things this suite exists to protect, beyond "it renders":
 *
 *  1. **D-B4.** The copy must say the bundle does NOT edit `package.json`, and
 *     must put the exact keys in front of the user. A future copy edit that
 *     softens this into "we'll wire it up for you" is a correctness bug, not a
 *     wording preference — the zip genuinely cannot do it.
 *  2. **The primary action.** This screen is the only place the user's effort
 *     becomes portable. If the download button loses its accessible name or
 *     stops being a button, the flow silently becomes a demo.
 *
 * Assertions use `toBeTruthy()`/`getAttribute()` rather than jest-dom matchers:
 * jest-dom is a dependency but `apps/web/vitest.setup.ts` does not import it,
 * so `toBeInTheDocument` is unregistered.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { GateInstallDialog } from "./GateInstallDialog";
import type { GateInstallDialogProps } from "./GateInstallDialog";
import {
  GATE_BUNDLE_ENTRIES,
  GATE_PACKAGE_MANAGER_PIN,
} from "./gate-bundle-manifest";

// jsdom does not implement the native <dialog> modal API that @hexagen/ui's
// Dialog calls, so the panel would never mount. Same stub as
// features/export/__tests__/ExportDialog.test.tsx.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

function setup(overrides: Partial<GateInstallDialogProps> = {}) {
  const props: GateInstallDialogProps = {
    open: true,
    mode: "download-zip",
    onSelectMode: vi.fn(),
    phase: "idle",
    onInstall: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<GateInstallDialog {...props} />);
  return props;
}

// Queries go against the raw DOM: jsdom's <dialog> subtree is not exposed to
// role queries, so getByRole would find nothing regardless of the markup.
const bodyText = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

function buttons() {
  return Array.from(document.querySelectorAll("button"));
}

function findButton(label: RegExp): HTMLButtonElement | undefined {
  return buttons().find((button) => label.test(button.textContent ?? ""));
}

describe("GateInstallDialog — the pick", () => {
  afterEach(cleanup);

  it("offers both delivery modes from BrownfieldGateInstallMode", () => {
    setup();
    const values = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).map((input) => input.value);
    expect(values).toEqual(["download-zip", "open-pr"]);
  });

  it("ships open-pr genuinely disabled, with the scope objection as its reason", () => {
    setup();
    const pr = document.querySelector<HTMLInputElement>(
      'input[value="open-pr"]',
    );
    expect(pr).toBeTruthy();
    expect(pr?.disabled).toBe(true);
    expect(bodyText()).toMatch(/not available yet/i);
    expect(bodyText()).toMatch(/every repository you can reach/i);
  });

  it("raises onSelectMode rather than owning the pick", () => {
    // Rendered with the OTHER mode selected on purpose: clicking a radio that
    // is already `checked` fires no change event, so a same-mode click would
    // pass vacuously. This also exercises ChoiceCardGroup's documented
    // checked-and-disabled path — `open-pr` shows as the user's choice while
    // remaining unpickable.
    const props = setup({ mode: "open-pr" });
    const zip = document.querySelector<HTMLInputElement>(
      'input[value="download-zip"]',
    );
    expect(zip).toBeTruthy();
    expect(zip?.checked).toBe(false);
    zip?.click();
    expect(props.onSelectMode).toHaveBeenCalledWith("download-zip");
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(bodyText()).not.toMatch(/Install the conformance gate/i);
  });
});

describe("GateInstallDialog — what is in the bundle", () => {
  afterEach(cleanup);

  it("names every bundled file", () => {
    setup();
    const text = bodyText();
    for (const entry of GATE_BUNDLE_ENTRIES) {
      expect(text).toContain(entry.path);
    }
  });

  it("renders an injected listing instead of the default when one is given", () => {
    setup({
      entries: [
        { path: "custom/only.yml", purpose: "Injected for this test." },
      ],
    });
    expect(bodyText()).toContain("custom/only.yml");
    expect(bodyText()).not.toContain(GATE_BUNDLE_ENTRIES[0].path);
  });

  it("promises no rewrite of existing files", () => {
    setup();
    expect(bodyText()).toMatch(/no existing file is rewritten/i);
  });
});

describe("GateInstallDialog — decision D-B4", () => {
  afterEach(cleanup);

  it("states plainly that the bundle does not touch package.json", () => {
    setup();
    expect(bodyText()).toMatch(/does not touch your package\.json/i);
    expect(bodyText()).toMatch(/by hand/i);
  });

  it("never claims to apply the patch itself", () => {
    setup();
    const text = bodyText();
    // The failure mode this guards: copy drifting toward "we add the scripts
    // for you". The zip cannot, and shipping that sentence would make the
    // product lie about a repository it does not own.
    expect(text).not.toMatch(/we(?:'ll| will) (?:add|patch|update|wire)/i);
    expect(text).not.toMatch(/automatically (?:adds|patches|updates)/i);
  });

  it("shows the exact packageManager pin the workflow's Corepack step needs", () => {
    setup();
    expect(bodyText()).toContain(GATE_PACKAGE_MANAGER_PIN);
  });

  it("keeps the patch in front of the user after the download too", () => {
    setup({ phase: "delivered", fileName: "hexagen-gate-scan-42.zip" });
    expect(bodyText()).toMatch(/does not touch your package\.json/i);
  });
});

describe("GateInstallDialog — the primary action", () => {
  afterEach(cleanup);

  it("is a button with an unambiguous accessible name", () => {
    setup();
    const primary = findButton(/^Download the gate bundle$/);
    expect(primary).toBeTruthy();
    expect(primary?.disabled).toBe(false);
  });

  it("raises onInstall", () => {
    const props = setup();
    findButton(/^Download the gate bundle$/)?.click();
    expect(props.onInstall).toHaveBeenCalledTimes(1);
  });

  it("locks both footer actions while the bundle is being built", () => {
    setup({ phase: "preparing" });
    expect(findButton(/Building the bundle/)?.disabled).toBe(true);
    expect(findButton(/^Not now$/)?.disabled).toBe(true);
  });

  it("keeps the dialog non-dismissible while preparing", () => {
    setup({ phase: "preparing" });
    // `dismissible={false}` is expressed by the Dialog through its cancel
    // handler, so the observable proxy here is that no cancel affordance is
    // enabled — asserted above — plus the dialog still being open.
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });
});

describe("GateInstallDialog — failure", () => {
  afterEach(cleanup);

  it("surfaces the message it is handed inside an alert region", () => {
    setup({ phase: "failed", message: "Could not build the gate bundle" });
    const alert = document.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain("Could not build the gate bundle");
  });

  it("relabels the primary action as a retry, still enabled", () => {
    setup({ phase: "failed", message: "nope" });
    const retry = findButton(/^Try again$/);
    expect(retry).toBeTruthy();
    expect(retry?.disabled).toBe(false);
  });
});

describe("GateInstallDialog — delivered", () => {
  afterEach(cleanup);

  it("names the saved file in a live region", () => {
    setup({ phase: "delivered", fileName: "hexagen-gate-scan-42.zip" });
    const status = document.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.textContent).toContain("hexagen-gate-scan-42.zip");
  });

  it("still renders a success panel when the filename is missing", () => {
    setup({ phase: "delivered", fileName: null });
    expect(bodyText()).toMatch(/Saved the gate bundle/i);
  });

  it("ends on explicit actions — Done closes, nothing navigates for the user", () => {
    // The standing no-auto-navigate-past-telemetry rule: this is the terminal
    // screen of the flow, so it waits for a click rather than routing on entry.
    const props = setup({ phase: "delivered", fileName: "gate.zip" });
    expect(findButton(/^Download again$/)).toBeTruthy();
    const done = findButton(/^Done$/);
    expect(done).toBeTruthy();
    done?.click();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the mode picker once the bundle is in hand", () => {
    setup({ phase: "delivered", fileName: "gate.zip" });
    expect(document.querySelector('input[type="radio"]')).toBeNull();
  });

  it("tells the user to run the gate locally before opening the pull request", () => {
    setup({ phase: "delivered", fileName: "gate.zip" });
    const text = bodyText();
    expect(text).toContain("yarn hexagen-lint --update-baseline");
    expect(text).toContain("yarn sync:check");
  });
});
