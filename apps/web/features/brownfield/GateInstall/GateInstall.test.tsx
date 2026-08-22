/**
 * The S7 seam: container -> hook -> route, and container -> dialog.
 *
 * Small on purpose — the phase machine is covered in `useGateInstall.test.ts`
 * and the panels in `GateInstallDialog.test.tsx`. What is only testable here is
 * that the wiring exists at all (a click really does reach `fetch`) and that
 * closing the dialog clears the previous outcome, which is the one piece of
 * state the container itself owns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

import { GateInstall } from "./GateInstall";
import { INSTALL_GATE_ENDPOINT } from "./gate-bundle-manifest";

const harness = vi.hoisted(() => ({ downloadBlob: vi.fn() }));

vi.mock("@/lib/download-blob", () => ({
  downloadBlob: harness.downloadBlob,
}));

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

const fetchMock = vi.fn();

beforeEach(() => {
  harness.downloadBlob.mockReset();
  harness.downloadBlob.mockReturnValue({ success: true });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new Blob(["PK"], { type: "application/zip" })),
    json: () => Promise.reject(new Error("not json")),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bodyText = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

function findButton(label: RegExp): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((button) =>
    label.test(button.textContent ?? ""),
  );
}

describe("GateInstall", () => {
  it("takes the primary action all the way to BF-6.1's route", async () => {
    const onDelivered = vi.fn();
    render(
      <GateInstall
        open
        scanId="scan-42"
        onClose={vi.fn()}
        onDelivered={onDelivered}
      />,
    );

    await act(async () => {
      findButton(/^Download the gate bundle$/)?.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(INSTALL_GATE_ENDPOINT);
    expect(harness.downloadBlob).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith("download-zip");
    expect(bodyText()).toContain("hexagen-gate-scan-42.zip");
  });

  it("does not navigate or close itself on success", async () => {
    const onClose = vi.fn();
    render(<GateInstall open scanId="scan-42" onClose={onClose} />);

    await act(async () => {
      findButton(/^Download the gate bundle$/)?.click();
    });

    // The standing rule: a success arm never routes for the user. The dialog
    // stays up with an explicit Done.
    expect(onClose).not.toHaveBeenCalled();
    expect(findButton(/^Done$/)).toBeTruthy();
  });

  it("clears the previous outcome when it is closed and reopened", async () => {
    const { rerender } = render(
      <GateInstall open scanId="scan-42" onClose={vi.fn()} />,
    );

    await act(async () => {
      findButton(/^Download the gate bundle$/)?.click();
    });
    expect(findButton(/^Done$/)).toBeTruthy();

    await act(async () => {
      rerender(<GateInstall open={false} scanId="scan-42" onClose={vi.fn()} />);
    });
    await act(async () => {
      rerender(<GateInstall open scanId="scan-42" onClose={vi.fn()} />);
    });

    // Reopened on the pick, not on a stale success panel.
    expect(findButton(/^Download the gate bundle$/)).toBeTruthy();
    expect(findButton(/^Done$/)).toBeUndefined();
  });
});
